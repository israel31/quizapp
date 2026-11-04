// @ts-check
/**
 * Publish checks (section 21), as a pure function: blockers must be fixed
 * before publishing; warnings can be published anyway. Each issue says where
 * to fix it. The server runs its own checks too — these are for the admin.
 * Question rules come from the question-type registry, so the editor's
 * inline messages and these checks always agree.
 */

import { validateQuestion } from './question-types.js';
import { settingsIssues } from './settings-rules.js';
import { resolveAppearance, contrastCheck, hasOverrides, formatRatio } from './appearance.js';

/** @typedef {import('../types.js').Quiz} Quiz */
/** @typedef {'details' | 'questions' | 'settings'} QuizTab */

/**
 * @typedef {Object} PublishIssue
 * @property {string} id          stable key, e.g. "title" or "q3-correct"
 * @property {string} message     plain-language, tells the admin what to do
 * @property {QuizTab} tab        where it gets fixed
 * @property {string} [field]     the field to focus (Details or Settings tab)
 * @property {string} [questionId]
 * @property {string} [target]      which part of the question (text, marks, option:<id>…)
 */

/** How each registry issue reads in the Review & Publish checklist. */
const QUESTION_MESSAGES = {
  text: (/** @type {number} */ n) => `Question ${n} has no question text.`,
  marks: (/** @type {number} */ n) => `Question ${n} needs marks above 0.`,
  options: (/** @type {number} */ n) => `Question ${n} needs at least 2 options, and none can be empty.`,
  'options-max': (/** @type {number} */ n) => `Question ${n} has more than 10 options.`,
  alt: (/** @type {number} */ n) => `Question ${n} has an image without alt text. Describe it, or mark it as decorative.`,
  'accepted-max': (/** @type {number} */ n) => `Question ${n} has too many accepted answers.`,
  duplicate: (/** @type {number} */ n) => `Question ${n} has options with the same text.`,
  'accepted-duplicate': (/** @type {number} */ n) => `Question ${n} lists the same accepted answer twice.`
};

/**
 * @param {Pick<Quiz, 'title' | 'description' | 'instructions' | 'questions' | 'settings'> & { appearance?: Partial<Quiz['appearance']> }} quiz
 * @param {{ now?: Date, uploads?: { pending: number, failed: number } }} [options]
 * @returns {{ blockers: PublishIssue[], warnings: PublishIssue[] }}
 */
export function publishIssues(quiz, { now = new Date(), uploads = { pending: 0, failed: 0 } } = {}) {
  /** @type {PublishIssue[]} */
  const blockers = [];
  /** @type {PublishIssue[]} */
  const warnings = [];

  if (!quiz.title.trim()) blockers.push({ id: 'title', message: 'Add a title.', tab: 'details', field: 'title' });
  if (!quiz.questions.length) blockers.push({ id: 'questions', message: 'Add at least one question.', tab: 'questions' });

  quiz.questions.forEach((q, index) => {
    const n = index + 1;
    const at = { tab: /** @type {QuizTab} */ ('questions'), questionId: q.id };
    /** @type {Set<string>} */
    const done = new Set();
    for (const issue of validateQuestion(q)) {
      // One line per kind of problem per question (e.g. several empty options read as one).
      const code = issue.code === 'option-empty' ? 'options' : issue.code;
      if (done.has(code)) continue;
      done.add(code);
      const message = code === 'correct'
        ? (q.type === 'checkboxes' ? `Question ${n} needs at least one correct answer.` : `Question ${n} needs exactly one correct answer.`)
        : (/** @type {Record<string, (n: number) => string>} */ (QUESTION_MESSAGES))[code]?.(n) || `Question ${n}: ${issue.message}`;
      const id = code === 'duplicate' ? `q${n}-duplicates` : code === 'accepted-duplicate' ? `q${n}-accepted-duplicates` : `q${n}-${code}`;
      (issue.level === 'error' ? blockers : warnings).push({ id, message, ...at, target: issue.target });
    }
  });

  if (uploads.pending) blockers.push({ id: 'uploading', message: `${uploads.pending === 1 ? 'An image is' : `${uploads.pending} images are`} still uploading. Wait for ${uploads.pending === 1 ? 'it' : 'them'} to finish.`, tab: 'questions' });
  if (uploads.failed) blockers.push({ id: 'upload-failed', message: `${uploads.failed === 1 ? 'An image' : `${uploads.failed} images`} didn’t upload. Try again or remove ${uploads.failed === 1 ? 'it' : 'them'}.`, tab: 'questions' });

  const settings = settingsIssues(quiz.settings, { now });
  for (const issue of settings.filter((i) => i.level === 'error')) blockers.push({ id: issue.id, message: issue.message, tab: 'settings', field: issue.field });

  if (!quiz.description.trim()) warnings.push({ id: 'description', message: 'There’s no description. Participants see it in their quiz list.', tab: 'details', field: 'description' });
  if (!quiz.instructions.trim()) warnings.push({ id: 'instructions', message: 'There are no instructions for participants.', tab: 'details', field: 'instructions' });

  // Readability: once for the quiz's own colours, then for each question
  // whose custom style makes it hard to read.
  const quizLook = resolveAppearance(quiz.appearance);
  const quizContrast = contrastCheck(quizLook);
  if (!quizContrast.ok) {
    warnings.push({ id: 'contrast', message: `The quiz’s text is hard to read on its cards: contrast ${formatRatio(quizContrast.ratio)} (aim for ${quizContrast.required}:1).`, tab: 'details', field: 'appearance' });
  }
  quiz.questions.forEach((q, index) => {
    if (!hasOverrides(q.appearance)) return;
    const check = contrastCheck(resolveAppearance(quiz.appearance, q.appearance));
    if (check.ok) return;
    warnings.push({ id: `q${index + 1}-contrast`, message: `Question ${index + 1} is hard to read: contrast ${formatRatio(check.ratio)} (aim for ${check.required}:1).`, tab: 'questions', questionId: q.id, target: 'appearance' });
  });

  for (const issue of settings.filter((i) => i.level !== 'error')) warnings.push({ id: issue.id, message: issue.message, tab: 'settings', field: issue.field });

  return { blockers, warnings };
}
