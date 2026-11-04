// @ts-check
/**
 * The save-status indicator. It always tells the truth: "Saving…",
 * "All changes saved · just now", or what went wrong and what to do.
 * Screen readers hear the outcomes (saved, failed, offline…), not every
 * "Saving…", so they aren't flooded while someone types.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { formatRelative } from '../core/format.js';

/** @typedef {import('../core/autosave.js').SaveState} SaveState */

/**
 * @typedef {Object} SaveStatusActions
 * @property {() => void} onRetry
 * @property {() => void} onSignIn
 * @property {() => void} onConflict
 */

/** Check mark that draws itself (stroke-dashoffset). */
function drawnCheck() {
  const svg = icon('check', { size: 16, className: 'save-status__icon check-draw' });
  return svg;
}

/**
 * @param {HTMLElement[]} hosts   the same status can appear in several places (header and phone bar)
 * @param {SaveStatusActions} actions
 */
export function createSaveStatus(hosts, actions) {
  /** @type {SaveState | null} */
  let last = null;
  let ticker = 0;

  /**
   * @param {SaveState} state
   * @param {boolean} compact
   */
  function content(state, compact) {
    const action = (/** @type {string} */ label, /** @type {() => void} */ onClick) =>
      el('button', { type: 'button', class: 'save-status__action', text: label, on: { click: onClick } });
    switch (state.status) {
      case 'saving':
        return [el('span', { class: 'spinner save-status__spinner', attrs: { 'aria-hidden': 'true' } }), el('span', { text: 'Saving…' })];
      case 'dirty':
        return [el('span', { class: 'save-status__dot', attrs: { 'aria-hidden': 'true' } }), el('span', { text: compact ? 'Unsaved' : 'Unsaved changes' })];
      case 'error':
        return [icon('alertCircle', { size: 16, className: 'save-status__icon is-danger' }), el('span', { text: compact ? 'Not saved' : 'Couldn’t save' }), action('Retry', actions.onRetry)];
      case 'offline':
        return [icon('wifiOff', { size: 16, className: 'save-status__icon is-warning' }), el('span', { text: compact ? 'Offline' : 'Offline · saves when you reconnect' })];
      case 'auth':
        return [icon('lock', { size: 16, className: 'save-status__icon is-warning' }), el('span', { text: 'Not saved' }), action('Sign in', actions.onSignIn)];
      case 'conflict':
        return [icon('alertTriangle', { size: 16, className: 'save-status__icon is-danger' }), el('span', { text: compact ? 'Not saved' : 'Not saved · changed elsewhere' }), action('Review', actions.onConflict)];
      case 'invalid':
        return [icon('alertCircle', { size: 16, className: 'save-status__icon is-danger' }), el('span', { text: compact ? 'Fix to save' : 'Fix the highlighted field to save' })];
      case 'gone':
        return [icon('alertTriangle', { size: 16, className: 'save-status__icon is-danger' }), el('span', { text: 'Quiz no longer exists' })];
      case 'readonly':
        return [icon('lock', { size: 16, className: 'save-status__icon' }), el('span', { text: 'Read-only' })];
      default: {
        const when = state.savedAt ? formatRelative(state.savedAt) : '';
        return [
          state.savedAt && last?.status === 'saving' ? drawnCheck() : icon('check', { size: 16, className: 'save-status__icon' }),
          el('span', { text: compact ? 'Saved' : when ? `All changes saved · ${when}` : 'All changes saved' })
        ];
      }
    }
  }

  /** @param {SaveState} state */
  function render(state) {
    const changed = !last || last.status !== state.status;
    hosts.forEach((host) => {
      host.dataset.status = state.status;
      host.replaceChildren(...content(state, host.dataset.compact === 'true'));
      if (changed) {
        host.classList.remove('is-entering');
        void host.offsetWidth;
        host.classList.add('is-entering');
        if (state.status === 'error' || state.status === 'conflict') {
          host.querySelector('.save-status__icon')?.classList.add('is-shaking');
        }
      }
    });
    if (changed) {
      const messages = {
        saved: last && last.status === 'saving' ? 'All changes saved.' : '',
        error: 'Couldn’t save your changes. Trying again shortly.',
        offline: 'You’re offline. Your changes will save when you’re back online.',
        auth: 'Your session ended. Sign in again to save your changes.',
        conflict: 'This quiz was changed somewhere else, so your changes weren’t saved.',
        invalid: 'Some details need fixing before they can be saved.',
        readonly: '',
        gone: 'This quiz no longer exists.'
      };
      const message = /** @type {Record<string, string>} */ (messages)[state.status];
      if (message) announce(message, { assertive: state.status === 'error' || state.status === 'conflict' || state.status === 'auth' });
    }
    last = state;
    // Keep "just now" honest as time passes.
    window.clearInterval(ticker);
    if (state.status === 'saved' && state.savedAt) {
      ticker = window.setInterval(() => {
        hosts.forEach((host) => {
          if (host.dataset.compact === 'true') return;
          const text = host.querySelector('span:last-child');
          if (text && last?.savedAt) text.textContent = `All changes saved · ${formatRelative(last.savedAt)}`;
        });
      }, 20000);
    }
  }

  return { render };
}
