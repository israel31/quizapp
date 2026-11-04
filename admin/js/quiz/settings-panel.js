// @ts-check
/**
 * The Settings tab (section 20): timing, availability, attempts, grading and
 * results, grouped into cards with helper text. Problems are explained under
 * the setting as you change it (the same rules Review & Publish uses).
 * Once participants have started (locked), only a later close time, when results
 * appear and showing correct answers can change (section 19).
 * Instructions live in the Details tab; this tab links there.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { timeZoneLabel, formatDateTime, plural } from '../core/format.js';
import {
  settingsIssues, lockedSettingsProblem, EDITABLE_WHEN_LOCKED, SETTINGS_LIMITS,
  isoToLocalInput, localInputToIso, utcOffsetLabel
} from './settings-rules.js';

/** @typedef {import('../types.js').QuizSettings} QuizSettings */
/** @typedef {import('./settings-rules.js').SettingsIssue} SettingsIssue */

/**
 * @param {HTMLElement} host
 * @param {{
 *   settings: QuizSettings,
 *   saved: QuizSettings,
 *   locked?: boolean,
 *   readOnly?: boolean,
 *   onChange: (settings: QuizSettings) => void,
 *   onEditInstructions: () => void
 * }} options
 */
export function createSettingsPanel(host, options) {
  const { onChange, onEditInstructions } = options;
  let current = { ...options.settings };
  let saved = { ...options.saved };
  let locked = Boolean(options.locked);
  let readOnly = Boolean(options.readOnly);
  let lastDuration = current.durationMinutes || 30;
  let lastAttempts = current.maxAttempts || 2;

  /** Can this setting be changed right now? @param {keyof QuizSettings} key */
  const canEdit = (key) => !readOnly && (!locked || EDITABLE_WHEN_LOCKED.includes(key));

  /** @param {Partial<QuizSettings>} patch @param {string} [message] */
  function change(patch, message) {
    const next = { ...current, ...patch };
    if (locked) {
      const problem = lockedSettingsProblem(saved, next);
      if (problem) {
        sync();
        showLocal(Object.keys(patch)[0], problem);
        return;
      }
    }
    current = next;
    sync();
    onChange(current);
    if (message) announce(message);
  }

  // Building blocks ------------------------------------------------------------------

  /** @param {string} field */
  const slot = (field) => el('div', { class: 'setting-issues', data: { settingIssues: field }, id: `setting-${field}-issues`, attrs: { 'aria-live': 'polite' } });

  /**
   * @param {string} id
   * @param {string} iconName
   * @param {string} title
   * @param {string} description
   * @param {(HTMLElement | null)[]} body
   */
  const card = (id, iconName, title, description, body) => el('section', { class: 'card settings-card', id: `settings-${id}`, attrs: { 'aria-labelledby': `settings-${id}-title` } },
    el('div', { class: 'settings-card__head' },
      el('span', { class: 'settings-card__icon', attrs: { 'aria-hidden': 'true' } }, icon(iconName, { size: 20 })),
      el('div', { class: 'settings-card__titles' },
        el('h3', { class: 'card-title', id: `settings-${id}-title`, text: title }),
        el('p', { class: 'card__description', text: description }))),
    el('div', { class: 'settings-card__body' }, body));

  /**
   * Radio "option cards" with a title and a sentence each.
   * @param {keyof QuizSettings} key
   * @param {string} legend
   * @param {[string, string, string][]} choices  value, title, description
   * @param {(value: string) => unknown} toValue
   */
  const optionCards = (key, legend, choices, toValue = (v) => v) => el('fieldset', { class: 'option-cards', data: { setting: key } },
    el('legend', { class: 'field__label', text: legend }),
    el('div', { class: 'option-cards__grid' }, choices.map(([value, title, description]) => {
      const input = el('input', { type: 'radio', name: `setting-${key}`, value, attrs: { 'aria-describedby': `setting-${key}-${value}-desc` } });
      input.addEventListener('change', () => { if (input.checked) change({ [key]: toValue(value) }, `${legend}: ${title}.`); });
      return el('label', { class: 'option-card' }, input,
        el('span', { class: 'option-card__dot', attrs: { 'aria-hidden': 'true' } }),
        el('span', { class: 'option-card__text' },
          el('span', { class: 'option-card__title', text: title }),
          el('span', { class: 'option-card__desc', id: `setting-${key}-${value}-desc`, text: description })));
    })));

  /** @param {string} id @param {string} label @param {string} [hint] */
  const switchRow = (id, label, hint) => {
    const input = el('input', { type: 'checkbox', class: 'switch__input', id, attrs: { role: 'switch' } });
    return {
      input,
      element: el('label', { class: 'switch', for: id }, input,
        el('span', { class: 'switch__track', attrs: { 'aria-hidden': 'true' } }, el('span', { class: 'switch__thumb' })),
        el('span', { class: 'switch__label' }, el('span', { text: label }), hint ? el('span', { class: 'switch__hint', text: hint }) : null))
    };
  };

  // Timing ----------------------------------------------------------------------------
  const timed = switchRow('setting-timed', 'Time limit', 'Each participant gets this long once they start.');
  timed.input.addEventListener('change', () => change(
    { durationMinutes: timed.input.checked ? lastDuration : null },
    timed.input.checked ? `Time limit on: ${plural(lastDuration, 'minute')}.` : 'No time limit.'));
  const minutes = el('input', { class: 'input settings-number num', id: 'setting-durationMinutes', type: 'text', attrs: { inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'setting-durationMinutes-issues' } });
  minutes.addEventListener('input', () => {
    const value = minutes.value.trim();
    if (/^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= SETTINGS_LIMITS.durationMax) {
      lastDuration = Number(value);
      clearLocal('durationMinutes');
      change({ durationMinutes: lastDuration });
    } else showLocal('durationMinutes', `Use a whole number of minutes from 1 to ${SETTINGS_LIMITS.durationMax}.`);
  });
  minutes.addEventListener('change', () => {
    if (!localErrors.durationMinutes) return;
    minutes.value = String(current.durationMinutes ?? lastDuration);
    clearLocal('durationMinutes');
    announce(`Time limit kept at ${plural(current.durationMinutes ?? lastDuration, 'minute')}.`);
  });
  const minutesRow = el('div', { class: 'settings-reveal', data: { reveal: 'timed' } },
    el('div', { class: 'settings-reveal__inner' },
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'setting-durationMinutes', text: 'Minutes' }),
        el('div', { class: 'qcard__inline' }, minutes, el('span', { class: 'qcard__unit', text: 'minutes' })))));
  const timing = card('timing', 'clock', 'Timing', 'When time runs out, the quiz is submitted automatically. The server enforces this, not the browser.', [
    timed.element, minutesRow, slot('durationMinutes')
  ]);

  // Availability -----------------------------------------------------------------------
  /** @param {'opensAt' | 'closesAt'} key @param {string} label */
  const dateField = (key, label) => {
    const input = el('input', { class: 'input settings-date', id: `setting-${key}`, type: 'datetime-local', attrs: { 'aria-describedby': `setting-${key}-hint setting-${key}-issues` } });
    input.addEventListener('change', () => {
      const iso = localInputToIso(input.value);
      change({ [key]: iso }, iso ? `${label}: ${formatDateTime(iso)}.` : `${label} cleared.`);
    });
    const clear = el('button', { type: 'button', class: 'btn btn--small btn--ghost', data: { clear: key }, on: { click: () => { change({ [key]: null }, `${label} cleared.`); input.focus(); } } },
      icon('close', { size: 16 }), el('span', { class: 'btn__label', text: 'Clear' }));
    const hint = el('p', { class: 'field__hint', id: `setting-${key}-hint` });
    return {
      input, clear, hint,
      element: el('div', { class: 'field', data: { field: key } },
        el('label', { class: 'field__label', for: `setting-${key}`, text: label }),
        el('div', { class: 'settings-date-row' }, input, clear),
        hint,
        slot(key))
    };
  };
  const opens = dateField('opensAt', 'Opens');
  const closes = dateField('closesAt', 'Closes');
  const zone = timeZoneLabel();
  const availability = card('availability', 'calendar', 'Availability', `Times are in your time zone${zone ? `, ${zone}` : ''} (${utcOffsetLabel()}), and saved in UTC.`, [
    el('div', { class: 'settings-two' }, opens.element, closes.element)
  ]);

  // Attempts ---------------------------------------------------------------------------
  const attempts = el('input', { class: 'input settings-number num', id: 'setting-maxAttempts', type: 'text', attrs: { inputmode: 'numeric', autocomplete: 'off', 'aria-describedby': 'setting-maxAttempts-issues' } });
  attempts.addEventListener('input', () => {
    const value = attempts.value.trim();
    if (/^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= SETTINGS_LIMITS.attemptsMax) {
      lastAttempts = Number(value);
      clearLocal('maxAttempts');
      change({ maxAttempts: lastAttempts });
    } else showLocal('maxAttempts', `Allow 1 to ${SETTINGS_LIMITS.attemptsMax} attempts, or tick Unlimited.`);
  });
  attempts.addEventListener('change', () => {
    if (!localErrors.maxAttempts) return;
    attempts.value = String(current.maxAttempts ?? 1);
    clearLocal('maxAttempts');
  });
  const unlimitedInput = el('input', { type: 'checkbox', id: 'setting-unlimited' });
  unlimitedInput.addEventListener('change', () => change({ maxAttempts: unlimitedInput.checked ? null : lastAttempts },
    unlimitedInput.checked ? 'Unlimited attempts.' : `${plural(lastAttempts, 'attempt')} allowed.`));
  const scoring = optionCards('attemptScoring', 'Score that counts', [
    ['highest', 'Highest score', 'Their best attempt counts.'],
    ['latest', 'Latest attempt', 'Their most recent attempt counts.']
  ]);
  const scoringNote = el('p', { class: 'field__hint settings-muted' });
  const attemptsCard = card('attempts', 'restore', 'Attempts', 'How many times each participant can take the quiz.', [
    el('div', { class: 'settings-inline' },
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: 'setting-maxAttempts', text: 'Maximum attempts' }),
        attempts),
      el('label', { class: 'check settings-inline__check', for: 'setting-unlimited' }, unlimitedInput, el('span', { text: 'Unlimited' }))),
    slot('maxAttempts'),
    scoring,
    scoringNote
  ]);

  // Grading ----------------------------------------------------------------------------
  const checkboxScoring = optionCards('checkboxScoring', 'Checkbox questions', [
    ['all_or_nothing', 'All or nothing', 'Full marks only if a participant ticks every correct option and no wrong ones.'],
    ['partial', 'Partial credit', 'Each correct tick earns part of the marks; wrong ticks take some away, never below 0.']
  ]);
  const matching = optionCards('shortAnswerCaseSensitive', 'Short answers', [
    ['false', 'Ignore capital letters', '“Abuja” and “abuja” both match. Recommended.'],
    ['true', 'Capital letters must match', '“Abuja” matches, “abuja” doesn’t.']
  ], (v) => v === 'true');
  const grading = card('grading', 'checkCircle', 'Grading', 'How answers are marked. The server calculates every score; this only sets the rules.', [
    checkboxScoring,
    matching,
    el('p', { class: 'field__hint', text: 'Short-answer matching is the starting point for new short-answer questions; each question can still change it. Extra spaces are always ignored.' })
  ]);

  // Results ----------------------------------------------------------------------------
  const visibility = optionCards('resultVisibility', 'When participants see their results', [
    ['immediately', 'Straight after they submit', 'Auto-graded scores show at once; hand-graded parts show as pending.'],
    ['after_close', 'After the quiz closes', 'Everyone sees results at the same time. Needs a close time.'],
    ['manual', 'When you release them', 'Nothing shows until you release results.']
  ]);
  const correct = switchRow('setting-showCorrectAnswers', 'Show correct answers with results', 'Participants also see the right answers and your explanations.');
  correct.input.addEventListener('change', () => change({ showCorrectAnswers: correct.input.checked },
    correct.input.checked ? 'Correct answers will be shown with results.' : 'Correct answers won’t be shown.'));
  const results = card('results', 'results', 'Results', 'What participants see after they submit.', [visibility, slot('resultVisibility'), correct.element]);

  const instructions = el('section', { class: 'card settings-card settings-card--link' },
    el('div', { class: 'settings-card__head' },
      el('span', { class: 'settings-card__icon', attrs: { 'aria-hidden': 'true' } }, icon('fileText', { size: 20 })),
      el('div', { class: 'settings-card__titles' },
        el('h3', { class: 'card-title', text: 'Instructions for participants' }),
        el('p', { class: 'card__description', text: 'Instructions are written in the Details tab, next to the title and description.' }))),
    el('button', { type: 'button', class: 'btn btn--small', on: { click: onEditInstructions } },
      icon('edit', { size: 16 }), el('span', { class: 'btn__label', text: 'Edit instructions' })));

  const lockBanner = el('div', { class: 'settings-lock', attrs: { role: 'note' } });
  host.replaceChildren(
    el('div', { class: 'panel-head' },
      el('h2', { class: 'panel-title', text: 'Settings' }),
      el('p', { class: 'panel-lede', text: 'What participants experience: timing, availability, attempts, grading and results. Changes save automatically.' })),
    lockBanner,
    el('div', { class: 'settings-grid' }, timing, availability, attemptsCard, grading, results, instructions));

  // Keeping everything in step ---------------------------------------------------------

  /** @type {Record<string, string>} */
  const localErrors = {};
  /** @param {string} field @param {string} message */
  function showLocal(field, message) {
    localErrors[field] = message;
    paintIssues();
  }
  /** @param {string} field */
  function clearLocal(field) {
    delete localErrors[field];
    paintIssues();
  }

  /** @param {HTMLElement} fieldset @param {string} value */
  const pick = (fieldset, value) => {
    fieldset.querySelectorAll('input').forEach((input) => { input.checked = input.value === value; });
  };

  function sync() {
    timed.input.checked = current.durationMinutes !== null;
    minutesRow.classList.toggle('is-open', current.durationMinutes !== null);
    if (document.activeElement !== minutes) minutes.value = String(current.durationMinutes ?? lastDuration);
    opens.input.value = isoToLocalInput(current.opensAt);
    closes.input.value = isoToLocalInput(current.closesAt);
    opens.clear.hidden = !current.opensAt;
    closes.clear.hidden = !current.closesAt;
    opens.hint.textContent = current.opensAt ? `Opens ${formatDateTime(current.opensAt)}.` : 'Empty: opens as soon as it’s published.';
    closes.hint.textContent = current.closesAt ? `Closes ${formatDateTime(current.closesAt)}.` : 'Empty: stays open until you unpublish it.';
    if (locked && saved.closesAt) closes.input.min = isoToLocalInput(saved.closesAt);
    else closes.input.removeAttribute('min');
    unlimitedInput.checked = current.maxAttempts === null;
    attempts.disabled = !canEdit('maxAttempts') || current.maxAttempts === null;
    if (document.activeElement !== attempts) attempts.value = current.maxAttempts === null ? '' : String(current.maxAttempts);
    attempts.placeholder = current.maxAttempts === null ? 'Unlimited' : '';
    pick(scoring, current.attemptScoring);
    const single = current.maxAttempts === 1;
    scoring.classList.toggle('is-dimmed', single);
    scoringNote.textContent = single ? 'Only matters when more than one attempt is allowed.' : '';
    pick(checkboxScoring, current.checkboxScoring);
    pick(matching, String(Boolean(current.shortAnswerCaseSensitive)));
    pick(visibility, current.resultVisibility);
    correct.input.checked = current.showCorrectAnswers;

    // What can be changed right now
    timed.input.disabled = !canEdit('durationMinutes');
    minutes.disabled = !canEdit('durationMinutes');
    opens.input.disabled = !canEdit('opensAt');
    opens.clear.disabled = !canEdit('opensAt');
    closes.input.disabled = !canEdit('closesAt') || (locked && !saved.closesAt);
    closes.clear.disabled = !canEdit('closesAt') || locked;
    unlimitedInput.disabled = !canEdit('maxAttempts');
    for (const [fieldset, key] of /** @type {[HTMLElement, keyof QuizSettings][]} */ ([[scoring, 'attemptScoring'], [checkboxScoring, 'checkboxScoring'], [matching, 'shortAnswerCaseSensitive'], [visibility, 'resultVisibility']])) {
      fieldset.querySelectorAll('input').forEach((input) => { input.disabled = !canEdit(key); });
      fieldset.classList.toggle('is-locked', !canEdit(key));
    }
    correct.input.disabled = !canEdit('showCorrectAnswers');
    for (const section of [timing, attemptsCard, grading]) section.classList.toggle('is-locked', locked || readOnly);
    availability.classList.toggle('is-locked', readOnly);
    results.classList.toggle('is-locked', readOnly);
    lockBanner.hidden = !(locked || readOnly);
    lockBanner.replaceChildren(...(readOnly
      ? [icon('archive', { size: 18 }), el('span', { text: 'This quiz is archived, so its settings are read-only. Restore it to make changes.' })]
      : locked
        ? [icon('lock', { size: 18 }), el('span', { text: saved.closesAt
          ? 'Participants have started this quiz. You can still move the close time later and change when results are shown; other settings are locked to keep attempts fair.'
          : 'Participants have started this quiz. You can still change when results are shown; other settings are locked to keep attempts fair.' })]
        : []));
    paintIssues();
  }

  function paintIssues() {
    const issues = settingsIssues(current);
    host.querySelectorAll('[data-setting-issues]').forEach((node) => {
      const slotEl = /** @type {HTMLElement} */ (node);
      const field = /** @type {string} */ (slotEl.dataset.settingIssues);
      /** @type {{ level: string, message: string }[]} */
      const messages = localErrors[field]
        ? [{ level: 'error', message: localErrors[field] }]
        : issues.filter((issue) => issue.field === field && issue.id !== 'no-close');
      const key = messages.map((m) => `${m.level}:${m.message}`).join('|');
      if (slotEl.dataset.key === key) return;
      slotEl.dataset.key = key;
      slotEl.replaceChildren(...messages.map((m) => el('p', { class: ['setting-issue', `setting-issue--${m.level}`] },
        icon(m.level === 'error' ? 'alertCircle' : m.level === 'warning' ? 'alertTriangle' : 'info', { size: 16 }),
        el('span', { text: m.message }))));
      const control = /** @type {HTMLElement | null} */ (host.querySelector(`#setting-${field}`));
      if (control) {
        if (messages.some((m) => m.level === 'error')) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
      }
    });
  }

  sync();

  return {
    /**
     * Replace the settings shown (e.g. after loading the latest version, or a
     * status change). `saved` is what the server has, for the lock rules.
     * @param {QuizSettings} next
     * @param {{ saved?: QuizSettings, locked?: boolean, readOnly?: boolean }} [state]
     */
    set(next, state = {}) {
      current = { ...next };
      if (state.saved) saved = { ...state.saved };
      if (state.locked !== undefined) locked = state.locked;
      if (state.readOnly !== undefined) readOnly = state.readOnly;
      if (current.durationMinutes) lastDuration = current.durationMinutes;
      if (current.maxAttempts) lastAttempts = current.maxAttempts;
      Object.keys(localErrors).forEach((key) => delete localErrors[key]);
      sync();
    },
    /** What the server has now (after a save). @param {QuizSettings} next */
    setSaved(next) { saved = { ...next }; if (locked) sync(); },
    /** Go to a setting (Review & Publish → Fix). @param {string} field */
    focus(field) {
      const target = field === 'durationMinutes' && current.durationMinutes === null ? timed.input
        : field === 'resultVisibility' ? /** @type {HTMLElement | null} */ (visibility.querySelector('input:checked') || visibility.querySelector('input'))
          : /** @type {HTMLElement | null} */ (host.querySelector(`#setting-${field}`));
      const section = /** @type {HTMLElement | null} */ (target?.closest('.settings-card'));
      section?.scrollIntoView({ block: 'center' });
      section?.classList.remove('is-highlighted');
      void section?.offsetWidth;
      section?.classList.add('is-highlighted');
      target?.focus({ preventScroll: true });
    }
  };
}
