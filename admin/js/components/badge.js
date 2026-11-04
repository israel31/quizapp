// @ts-check
/**
 * Status and availability badges. Always an icon AND text — never color alone.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { STATUS_META, AVAILABILITY_META } from '../quiz/quiz-rules.js';
import { ATTEMPT_STATUS_META } from '../quiz/results-rules.js';

/** @typedef {import('../types.js').QuizStatus} QuizStatus */
/** @typedef {import('../types.js').Availability} Availability */

/** @param {QuizStatus} status */
export function statusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.draft;
  return el('span', { class: ['badge', `badge--${status}`], data: { badge: status } },
    icon(meta.icon, { size: 14 }),
    el('span', { text: meta.label })
  );
}

/**
 * @param {Availability} availability
 * @param {{ soon?: boolean }} [options]   soon: closing within a few days
 */
export function availabilityBadge(availability, { soon = false } = {}) {
  const meta = AVAILABILITY_META[availability] || AVAILABILITY_META.open;
  return el('span', { class: ['badge', `badge--${availability}`, soon ? 'badge--soon' : ''], data: { badge: availability } },
    icon(meta.icon, { size: 14 }),
    el('span', { text: meta.label })
  );
}

/**
 * An attempt's status (Results), as icon + words.
 * @param {import('../types.js').AttemptStatus} status
 */
export function attemptBadge(status) {
  const meta = ATTEMPT_STATUS_META[status] || ATTEMPT_STATUS_META.submitted;
  return el('span', { class: ['badge', 'attempt-badge', `attempt-badge--${meta.tone}`] }, icon(meta.icon, { size: 14 }), el('span', { text: meta.label }));
}
