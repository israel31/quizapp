// @ts-check
/**
 * Quiz settings rules (section 20), as pure functions, shared by the Settings
 * tab (inline messages) and Review & Publish (blockers and warnings), plus
 * what may still change once participants have started (section 19).
 * The server checks all of this again; these are for the admin.
 */
import { formatNumber, plural } from '../core/format.js';

/** @typedef {import('../types.js').QuizSettings} QuizSettings */
/**
 * @typedef {Object} SettingsIssue
 * @property {string} id
 * @property {'durationMinutes' | 'opensAt' | 'closesAt' | 'maxAttempts' | 'resultVisibility'} field
 * @property {'error' | 'warning' | 'info'} level   error = blocks publishing
 * @property {string} message
 */

export const SETTINGS_LIMITS = Object.freeze({ durationMax: 600, attemptsMax: 20 });

/** Settings that may still change after participants have started (section 19). */
export const EDITABLE_WHEN_LOCKED = Object.freeze(['closesAt', 'resultVisibility', 'showCorrectAnswers']);

/**
 * @param {QuizSettings} s
 * @param {{ now?: Date }} [options]
 * @returns {SettingsIssue[]}
 */
export function settingsIssues(s, { now = new Date() } = {}) {
  /** @type {SettingsIssue[]} */
  const issues = [];
  const duration = s.durationMinutes ?? null;
  const maxAttempts = s.maxAttempts ?? null;
  const opens = s.opensAt ? Date.parse(s.opensAt) : null;
  const closes = s.closesAt ? Date.parse(s.closesAt) : null;

  if (duration !== null && !(Number.isInteger(duration) && duration >= 1 && duration <= SETTINGS_LIMITS.durationMax)) {
    issues.push({ id: 'duration-invalid', field: 'durationMinutes', level: 'error', message: `The time limit must be a whole number of minutes from 1 to ${SETTINGS_LIMITS.durationMax}.` });
  }
  if (opens !== null && closes !== null && closes <= opens) {
    issues.push({ id: 'closes-before-opens', field: 'closesAt', level: 'error', message: 'The close time must be after the open time.' });
  } else if (closes !== null && closes <= now.getTime()) {
    issues.push({ id: 'closes-past', field: 'closesAt', level: 'error', message: 'The close time has already passed, so participants would never be able to start it. Choose a later time.' });
  }
  if (maxAttempts !== null && !(Number.isInteger(maxAttempts) && maxAttempts >= 1)) {
    issues.push({ id: 'attempts-min', field: 'maxAttempts', level: 'error', message: 'Allow at least 1 attempt.' });
  }
  if (s.resultVisibility === 'after_close' && closes === null) {
    issues.push({ id: 'results-no-close', field: 'resultVisibility', level: 'error', message: 'Results are set to show after the quiz closes, but it has no close time. Add a close time, or choose when results appear.' });
  }

  if (duration && opens !== null && closes !== null && closes > opens) {
    const window = Math.floor((closes - opens) / 60000);
    if (duration > window) {
      issues.push({ id: 'duration-window', field: 'durationMinutes', level: 'warning', message: `The time limit (${plural(duration, 'minute')}) is longer than the quiz is open (${plural(window, 'minute')}). Participants who start late may not get the full time.` });
    }
  }
  if (closes === null) issues.push({ id: 'no-close', field: 'closesAt', level: 'warning', message: 'There’s no close time, so it stays open until you unpublish it.' });
  if (opens !== null && opens < now.getTime()) issues.push({ id: 'opens-past', field: 'opensAt', level: 'info', message: 'The open time is in the past, so it opens as soon as it’s published.' });
  return issues;
}

/**
 * Once participants have started: may this change be made? Returns a message if not.
 * Only a later close time, when results appear, and showing correct answers
 * may change (section 19).
 * @param {QuizSettings} saved   what the server has
 * @param {QuizSettings} next
 * @returns {string | null}
 */
export function lockedSettingsProblem(saved, next) {
  for (const key of /** @type {(keyof QuizSettings)[]} */ (Object.keys(next))) {
    if (EDITABLE_WHEN_LOCKED.includes(key) || saved[key] === next[key]) continue;
    return 'Participants have started this quiz, so only the close time (later only), when results appear and showing correct answers can change.';
  }
  if (saved.closesAt !== next.closesAt) {
    if (!saved.closesAt) return 'This quiz has no close time. Adding one now would cut it short for participants who haven’t started.';
    if (!next.closesAt || Date.parse(next.closesAt) < Date.parse(saved.closesAt)) return 'You can only move the close time later.';
  }
  return null;
}

/** "WAT (UTC+1)" style label for the admin's time zone. @param {Date} [date] */
export function utcOffsetLabel(date = new Date()) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  return `UTC${sign}${formatNumber(hours)}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/**
 * ISO 8601 UTC → the value a datetime-local input shows (device time).
 * @param {string | null} iso
 */
export function isoToLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A datetime-local value (device time) → ISO 8601 UTC, or null if empty/invalid.
 * @param {string} value
 */
export function localInputToIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
