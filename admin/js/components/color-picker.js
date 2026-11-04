// @ts-check
/**
 * Colour control (section 17): a swatch that opens the device's own colour
 * picker, a hex field you can type into (#abc or #aabbcc), and a fold-out
 * row of suggested and recently used colours. Everything works with the
 * keyboard: Tab to each part, arrow keys move between swatches.
 * Not a full design suite on purpose.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { getPref, setPref } from '../core/storage.js';
import { normalizeHex } from '../quiz/appearance.js';

/** Suggested colours: the JCI palette and the preset colours. */
export const SUGGESTED_COLORS = Object.freeze([
  ['#130F2D', 'JCI Black'], ['#0097D7', 'JCI Blue'], ['#FFFFFF', 'White'], ['#000000', 'Black'],
  ['#EEF6FB', 'Ice blue'], ['#F7F3EA', 'Paper'], ['#FFFDF8', 'Cream'], ['#2B2A28', 'Ink'],
  ['#0B0A14', 'Night'], ['#17152A', 'Night card'], ['#F5F6FA', 'Soft white'], ['#15803D', 'Green'],
  ['#B91C1C', 'Red'], ['#6D28D9', 'Purple']
]);
const RECENT_MAX = 6;

/** Recently used colours on this device (a preference, not quiz data). */
export function recentColors() {
  try {
    const list = JSON.parse(getPref('recent-colors') || '[]');
    return Array.isArray(list) ? list.map(normalizeHex).filter(Boolean).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** @param {string} hex */
function remember(hex) {
  const list = [hex, ...recentColors().filter((c) => c !== hex)].slice(0, RECENT_MAX);
  setPref('recent-colors', JSON.stringify(list));
}

/**
 * @param {{
 *   id: string,
 *   label: string,
 *   value: string,
 *   onChange: (hex: string) => void,
 *   disabled?: boolean,
 *   describedBy?: string
 * }} options
 */
export function createColorPicker({ id, label, value, onChange, disabled = false, describedBy }) {
  let current = normalizeHex(value) || '#000000';
  const swatchesId = `${id}-swatches`;
  const errorId = `${id}-error`;

  const native = el('input', {
    type: 'color',
    class: 'color-field__native',
    value: current.toLowerCase(),
    disabled,
    attrs: { 'aria-label': `${label}: open the colour picker` }
  });
  const chip = el('span', { class: 'color-field__chip', attrs: { 'aria-hidden': 'true' } });
  const swatchButton = el('label', { class: 'color-field__swatch' }, native, chip);
  const hex = el('input', {
    type: 'text',
    class: 'input color-field__hex num',
    id,
    value: current,
    maxLength: 7,
    disabled,
    attrs: { spellcheck: 'false', autocomplete: 'off', autocapitalize: 'characters', 'aria-describedby': [describedBy, errorId].filter(Boolean).join(' ') }
  });
  const toggle = el('button', {
    type: 'button',
    class: 'btn btn--ghost btn--icon color-field__toggle',
    disabled,
    attrs: { 'aria-expanded': 'false', 'aria-controls': swatchesId, 'aria-label': `${label}: suggested colours` }
  }, icon('chevronDown', { size: 18 }));
  const error = el('p', { class: 'color-field__error', id: errorId, attrs: { 'aria-live': 'polite' } });
  const panel = el('div', { class: 'color-field__panel', id: swatchesId, hidden: true });

  const root = el('div', { class: 'color-field', data: { colorField: id } },
    el('div', { class: 'color-field__row' }, swatchButton, hex, toggle),
    error,
    panel);

  /** @param {string} next @param {{ commit?: boolean, from?: 'hex' | 'other' }} [how] */
  function set(next, { commit = false, from = 'other' } = {}) {
    const clean = normalizeHex(next);
    if (!clean) return;
    const changed = clean !== current;
    current = clean;
    chip.style.background = clean;
    native.value = clean.toLowerCase();
    if (from !== 'hex') hex.value = clean;
    hex.removeAttribute('aria-invalid');
    error.textContent = '';
    if (changed) onChange(clean);
    if (commit) {
      remember(clean);
      if (!panel.hidden) {
        // Redraw (the Recent row changed) but keep keyboard focus on the chosen swatch.
        const hadFocus = panel.contains(document.activeElement);
        renderPanel();
        if (hadFocus) /** @type {HTMLElement | null} */ (panel.querySelector(`.color-swatch[data-color="${clean}"]`))?.focus();
      }
    } else if (!panel.hidden) markPressed();
  }

  native.addEventListener('input', () => set(native.value));
  native.addEventListener('change', () => set(native.value, { commit: true }));
  hex.addEventListener('input', () => {
    const clean = normalizeHex(hex.value);
    if (clean) set(clean, { from: 'hex' });
  });
  const commitHex = () => {
    const clean = normalizeHex(hex.value);
    if (clean) {
      set(clean, { commit: true });
      return;
    }
    // Explain, then put the last good colour back so nothing invalid is kept.
    error.textContent = `Use a colour code like #130F2D. Kept ${current}.`;
    hex.value = current;
  };
  hex.addEventListener('change', commitHex);
  hex.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitHex();
    }
  });

  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      renderPanel();
      /** @type {HTMLElement | null} */ (panel.querySelector('[tabindex="0"]'))?.focus();
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });

  /** @param {string} heading @param {[string, string][]} colors */
  function group(heading, colors) {
    const headingId = `${id}-${heading.toLowerCase()}`;
    const buttons = colors.map(([color, name]) => el('button', {
      type: 'button',
      class: 'color-swatch',
      data: { color },
      attrs: { 'aria-label': name ? `${name} ${color}` : color, 'aria-pressed': String(color === current), tabindex: '-1', title: name ? `${name} ${color}` : color },
      on: { click: () => set(color, { commit: true }) }
    }, el('span', { class: 'color-swatch__fill', attrs: { 'aria-hidden': 'true' } })));
    buttons.forEach((button) => {
      const fill = /** @type {HTMLElement} */ (button.firstElementChild);
      fill.style.background = /** @type {string} */ (button.dataset.color);
    });
    return el('div', { class: 'color-field__group' },
      el('p', { class: 'color-field__heading', id: headingId, text: heading }),
      el('div', { class: 'color-field__swatches', attrs: { role: 'group', 'aria-labelledby': headingId } }, buttons));
  }

  function renderPanel() {
    const recent = recentColors();
    panel.replaceChildren(
      group('Suggested', /** @type {[string, string][]} */ (SUGGESTED_COLORS.map(([c, n]) => [c, n]))),
      recent.length ? group('Recent', recent.map((c) => /** @type {[string, string]} */ ([/** @type {string} */ (c), '']))) : '');
    markPressed();
  }

  /** One swatch is focusable at a time; arrow keys move between them. */
  function markPressed() {
    const all = /** @type {HTMLElement[]} */ ([...panel.querySelectorAll('.color-swatch')]);
    all.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.color === current)));
    const active = all.find((button) => button.dataset.color === current) || all[0];
    all.forEach((button) => { button.tabIndex = button === active ? 0 : -1; });
  }
  panel.addEventListener('keydown', (event) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const all = /** @type {HTMLElement[]} */ ([...panel.querySelectorAll('.color-swatch')]);
    const at = all.indexOf(/** @type {HTMLElement} */ (document.activeElement));
    if (at < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1
      : (at + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all.forEach((button, index) => { button.tabIndex = index === next ? 0 : -1; });
    all[next].focus();
  });

  chip.style.background = current;
  return {
    element: root,
    /** Show a value without reporting a change. @param {string} next */
    set(next) {
      const clean = normalizeHex(next);
      if (!clean) return;
      current = clean;
      chip.style.background = clean;
      native.value = clean.toLowerCase();
      if (document.activeElement !== hex) hex.value = clean;
      if (!panel.hidden) markPressed();
    },
    /** @param {boolean} on */
    setDisabled(on) {
      native.disabled = on;
      hex.disabled = on;
      toggle.disabled = on;
      if (on) panel.hidden = true;
    },
    get value() { return current; }
  };
}
