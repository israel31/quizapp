// @ts-check
/**
 * Results helpers (section 24), as plain functions: status labels, time
 * taken, percentages and grading progress. They only DISPLAY what the backend
 * sends — scores and totals are never calculated here.
 */
import { formatNumber } from '../core/format.js';

/** @typedef {import('../types.js').Attempt} Attempt */
/** @typedef {import('../types.js').AttemptSummary} AttemptSummary */
/** @typedef {import('../types.js').AttemptStatus} AttemptStatus */

/** Always shown as icon + words (section 24). */
export const ATTEMPT_STATUS_META = Object.freeze({
  in_progress: { label: 'In progress', icon: 'clock', tone: 'progress' },
  submitted: { label: 'Submitted', icon: 'send', tone: 'neutral' },
  pending_grading: { label: 'Waiting for grading', icon: 'edit', tone: 'waiting' },
  graded: { label: 'Graded', icon: 'checkCircle', tone: 'done' }
});

export const ATTEMPT_SORTS = Object.freeze([
  ['submittedAt:desc', 'Submitted (newest)'],
  ['submittedAt:asc', 'Submitted (oldest)'],
  ['score:desc', 'Score (highest)'],
  ['score:asc', 'Score (lowest)'],
  ['name:asc', 'Name A–Z']
]);

export const RESULTS_LIST_SCHEMA = Object.freeze({
  filters: Object.freeze({ status: Object.freeze(['', 'in_progress', 'submitted', 'pending_grading', 'graded']) }),
  sorts: Object.freeze(ATTEMPT_SORTS.map(([value]) => value)),
  defaultSort: 'submittedAt:desc'
});

/**
 * "12 min 30 s", "1 h 5 min", "45 s"; empty when there's no end time yet.
 * @param {string} start
 * @param {string | null} end
 */
export function timeTaken(start, end) {
  if (!end) return '';
  const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return `${h} h${m ? ` ${m} min` : ''}`;
  if (m) return `${m} min${s ? ` ${s} s` : ''}`;
  return `${s} s`;
}

/**
 * The percentage of the backend's score, rounded to 1 decimal place, or null.
 * @param {number | null} score
 * @param {number} maxScore
 */
export function percentOf(score, maxScore) {
  if (score === null || !maxScore) return null;
  return Math.round((score / maxScore) * 1000) / 10;
}

/** "31.5 / 40" @param {number | null} score @param {number} maxScore */
export function scoreText(score, maxScore) {
  return score === null ? `— / ${formatNumber(maxScore)}` : `${formatNumber(score)} / ${formatNumber(maxScore)}`;
}

/**
 * How many answers need a grader, and how many are done.
 * @param {Pick<Attempt, 'answers'>} attempt
 */
export function gradingProgress(attempt) {
  const manual = attempt.answers.filter((a) => a.needsManualGrading);
  return { graded: manual.filter((a) => a.manualMarks !== null).length, total: manual.length };
}

/**
 * Provisional while anything waits for a grader; Final once graded.
 * @param {AttemptStatus} status
 * @returns {'final' | 'provisional' | null}
 */
export function scoreState(status) {
  if (status === 'graded') return 'final';
  if (status === 'pending_grading' || status === 'submitted') return 'provisional';
  return null;
}

/**
 * Check a grader's marks: 0 up to the question's marks, at most 2 decimals.
 * @param {string} text
 * @param {number} max
 * @returns {{ value: number } | { error: string }}
 */
export function parseGrade(text, max) {
  const value = String(text).trim().replace(',', '.');
  if (!value) return { error: 'Enter the marks for this answer.' };
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(value)) return { error: 'Use a number with up to 2 decimal places, like 3 or 2.5.' };
  const number = Number(value);
  if (number > max) return { error: `This question is worth ${formatNumber(max)} mark${max === 1 ? '' : 's'} at most.` };
  return { value: number };
}
