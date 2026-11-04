// @ts-check
/**
 * Plain data helpers for questions: ids, copies, change detection and the
 * save operations derived from it. No DOM, so they're easy to test.
 */

/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../types.js').Option} Option */
/** @typedef {import('../types.js').QuizImage} QuizImage */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;
export const MAX_ACCEPTED_ANSWERS = 20;
export const LIMITS = Object.freeze({ text: 2000, option: 300, explanation: 1000, accepted: 100, gradingNotes: 2000, maxLength: 10000, marks: 1000 });

/**
 * A new id. The admin site creates question and option ids itself (UUIDs),
 * so a save that's retried after a timeout can never create a duplicate.
 */
export function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/** @param {string} [text] @returns {Option} */
export function blankOption(text = '') {
  return { id: newId(), text, image: null, isCorrect: false };
}

/**
 * A full copy with fresh ids for the question and its options.
 * @param {Question} question
 * @returns {Question}
 */
export function copyQuestion(question) {
  const copy = /** @type {Question} */ (JSON.parse(JSON.stringify(question)));
  copy.id = newId();
  copy.source = null;
  if (copy.options) copy.options = copy.options.map((option) => ({ ...option, id: newId() }));
  return copy;
}

/**
 * Move one item; returns a new array.
 * @template T
 * @param {T[]} list
 * @param {number} from
 * @param {number} to
 * @returns {T[]}
 */
export function moveItem(list, from, to) {
  const next = list.slice();
  if (from === to || from < 0 || from >= list.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** Quiz total, rounded to 2 decimal places. @param {Pick<Question, 'marks'>[]} questions */
export function totalMarks(questions) {
  return Math.round(questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0) * 100) / 100;
}

/**
 * Read a marks field: more than 0, at most 2 decimal places (section 15).
 * @param {string} text
 * @returns {{ value: number } | { error: string }}
 */
export function parseMarks(text) {
  const value = String(text).trim().replace(',', '.');
  if (!value) return { error: 'Enter the marks for this question.' };
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(value)) return { error: 'Use a number with up to 2 decimal places, like 2 or 1.5.' };
  const number = Number(value);
  if (number <= 0) return { error: 'Marks must be more than 0.' };
  if (number > LIMITS.marks) return { error: `Marks can’t be more than ${LIMITS.marks}.` };
  return { value: number };
}

/**
 * Read an optional maximum answer length: blank means no limit.
 * @param {string} text
 * @returns {{ value: number | null } | { error: string }}
 */
export function parseMaxLength(text) {
  const value = String(text).trim();
  if (!value) return { value: null };
  if (!/^\d+$/.test(value) || Number(value) < 1) return { error: 'Use a whole number of characters, or leave it empty.' };
  if (Number(value) > LIMITS.maxLength) return { error: `Up to ${LIMITS.maxLength.toLocaleString('en-GB')} characters.` };
  return { value: Number(value) };
}

const norm = (/** @type {unknown} */ value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

/** @param {QuizImage | null | undefined} image */
function imageKey(image) {
  if (!image) return null;
  return { assetId: image.assetId, alt: norm(image.alt), decorative: Boolean(image.decorative), placement: image.placement || 'above', size: image.size || 'medium' };
}

/**
 * Everything an admin can change about a question, in a fixed shape, so a
 * local copy and the server's copy compare equal when they say the same.
 * @param {Question} q
 */
export function questionKey(q) {
  const textType = q.type === 'short_answer' || q.type === 'paragraph';
  return JSON.stringify({
    type: q.type,
    text: norm(q.text),
    marks: Number(q.marks) || 0,
    explanation: norm(q.explanation),
    image: imageKey(q.image),
    options: q.type === 'multiple_choice' || q.type === 'checkboxes'
      ? (q.options || []).map((o) => ({ id: o.id, text: norm(o.text), isCorrect: Boolean(o.isCorrect), image: imageKey(o.image) }))
      : null,
    acceptedAnswers: q.type === 'short_answer' ? (q.acceptedAnswers || []).map(norm) : null,
    caseSensitive: q.type === 'short_answer' ? Boolean(q.caseSensitive) : null,
    maxLength: textType ? (q.maxLength ?? null) : null,
    gradingNotes: q.type === 'paragraph' ? norm(q.gradingNotes) : null,
    appearance: q.appearance || {},
    source: q.source ? { id: q.source.bankQuestionId, v: q.source.bankVersion } : null
  });
}

/**
 * @typedef {{ kind: 'delete', id: string }
 *   | { kind: 'create', question: Question, position: number }
 *   | { kind: 'update', question: Question }
 *   | { kind: 'order', ids: string[] }} QuestionOp
 */

/**
 * The server calls needed to turn `saved` into `current`, most important
 * first: deletes, creates (at the right position), updates, then order.
 * Recomputed after every call, so rapid edits collapse into one update and a
 * delete that's undone in time never reaches the server.
 * @param {Question[]} saved
 * @param {Question[]} current
 * @returns {QuestionOp[]}
 */
export function questionOps(saved, current) {
  const savedById = new Map(saved.map((q) => [q.id, q]));
  const currentIds = new Set(current.map((q) => q.id));
  /** @type {QuestionOp[]} */
  const ops = [];

  for (const q of saved) if (!currentIds.has(q.id)) ops.push({ kind: 'delete', id: q.id });

  let onServer = 0;
  for (const q of current) {
    if (savedById.has(q.id)) onServer += 1;
    else ops.push({ kind: 'create', question: q, position: onServer + 1 });
  }

  for (const q of current) {
    const before = savedById.get(q.id);
    if (before && questionKey(before) !== questionKey(q)) ops.push({ kind: 'update', question: q });
  }

  const savedOrder = saved.filter((q) => currentIds.has(q.id)).map((q) => q.id);
  const currentOrder = current.filter((q) => savedById.has(q.id)).map((q) => q.id);
  if (savedOrder.join('|') !== currentOrder.join('|')) ops.push({ kind: 'order', ids: current.map((q) => q.id) });
  return ops;
}

// Question Bank (Stage 8) -------------------------------------------------------------

/** @typedef {import('../types.js').BankQuestion} BankQuestion */

/**
 * A snapshot of a bank question for a quiz: new ids (question and options),
 * linked back to the bank question and the version it came from.
 * @param {BankQuestion} bank
 * @returns {Question}
 */
export function questionFromBank(bank) {
  const { tags, status, version, usedInQuizCount, createdAt, updatedAt, ...content } = bank;
  const copy = /** @type {Question} */ (JSON.parse(JSON.stringify(content)));
  copy.id = newId();
  copy.order = 0;
  copy.appearance = copy.appearance || {};
  copy.source = { bankQuestionId: bank.id, bankVersion: bank.version };
  if (copy.options) copy.options = copy.options.map((option) => ({ ...option, id: newId() }));
  return copy;
}

/**
 * A quiz question's content as a NEW bank question (fresh ids, no link).
 * @param {Question} q
 * @returns {Omit<Question, 'order' | 'source'>}
 */
export function bankDraftFromQuestion(q) {
  const { order, source, ...content } = /** @type {Question} */ (JSON.parse(JSON.stringify(q)));
  return { ...content, id: newId(), options: content.options?.map((option) => ({ ...option, id: newId() })) };
}

/** @typedef {Pick<Question, 'type' | 'text' | 'marks' | 'image' | 'explanation' | 'options' | 'acceptedAnswers' | 'caseSensitive' | 'gradingNotes' | 'maxLength' | 'appearance'>} QuestionContent */

/**
 * What differs between two versions of a question, in words.
 * @param {QuestionContent} a
 * @param {QuestionContent} b
 * @returns {string[]}
 */
export function questionDifferences(a, b) {
  const same = (/** @type {unknown} */ x, /** @type {unknown} */ y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const img = (/** @type {Question['image']} */ i) => (i ? { a: i.assetId, alt: norm(i.alt), d: i.decorative, p: i.placement, s: i.size } : null);
  /** @type {string[]} */
  const out = [];
  if (a.type !== b.type) out.push('Question type');
  if (norm(a.text) !== norm(b.text)) out.push('Question text');
  if (Number(a.marks) !== Number(b.marks)) out.push('Marks');
  if (!same(img(a.image), img(b.image))) out.push('Image');
  const texts = (/** @type {QuestionContent} */ q) => (q.options || []).map((o) => [norm(o.text), img(o.image)]);
  if (!same(texts(a), texts(b))) out.push('Options');
  const correct = (/** @type {QuestionContent} */ q) => (q.options || []).map((o) => (o.isCorrect ? norm(o.text) : null)).filter(Boolean);
  if (!same(correct(a), correct(b))) out.push('Correct answers');
  if (!same((a.acceptedAnswers || []).map(norm), (b.acceptedAnswers || []).map(norm)) || Boolean(a.caseSensitive) !== Boolean(b.caseSensitive)) out.push('Accepted answers');
  if (norm(a.explanation) !== norm(b.explanation)) out.push('Explanation');
  if (norm(a.gradingNotes) !== norm(b.gradingNotes)) out.push('Grading notes');
  if ((a.maxLength ?? null) !== (b.maxLength ?? null)) out.push('Answer length');
  if (!same(a.appearance || {}, b.appearance || {})) out.push('Appearance');
  return out;
}
