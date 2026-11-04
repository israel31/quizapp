// @ts-check
/**
 * Stage 4: the question model, the type registry (validation and type
 * changes), the save operations, the question adapters, autosave across
 * several changes, publish checks with uploads, and the demo server's
 * question endpoints.
 */
import { test, assert, assertEqual, assertRejects } from './harness.js';
import {
  parseMarks, parseMaxLength, moveItem, totalMarks, copyQuestion, questionOps, blankOption, MAX_OPTIONS
} from '../quiz/question-model.js';
import { QUESTION_TYPES, TYPE_ORDER, createQuestion, validateQuestion, convertQuestion, questionsToText } from '../quiz/question-types.js';
import { publishIssues } from '../quiz/publish-checks.js';
import { questionToApi, imageToApi, uploadFromApi } from '../api/adapters.js';
import { createAutosave } from '../core/autosave.js';
import { ApiError } from '../api/client.js';
import * as mock from '../api/mock/mock-api.js';

/** @typedef {import('../types.js').Question} Question */

/** @param {Partial<Question>} [overrides] @returns {Question} */
const mc = (overrides = {}) => ({
  id: 'q1', type: 'multiple_choice', order: 1, text: 'Pick one', explanation: null, marks: 2, image: null, appearance: {}, source: null,
  options: [{ id: 'a', text: 'Alpha', image: null, isCorrect: true }, { id: 'b', text: 'Beta', image: null, isCorrect: false }],
  ...overrides
});
const codes = (/** @type {Question} */ q) => validateQuestion(q).map((issue) => `${issue.level}:${issue.code}`);

/* Marks and lengths ------------------------------------------------------------ */
test('questions: marks must be above 0, with at most 2 decimal places', () => {
  assertEqual(parseMarks('2'), { value: 2 });
  assertEqual(parseMarks(' 1.5 '), { value: 1.5 });
  assertEqual(parseMarks('1,25'), { value: 1.25 }, 'a decimal comma is accepted');
  for (const bad of ['', '0', '-1', '2.555', '1001', 'abc', '1e2']) assert('error' in parseMarks(bad), `"${bad}" is refused`);
});

test('questions: max length is optional, a whole number up to 10,000', () => {
  assertEqual(parseMaxLength(''), { value: null });
  assertEqual(parseMaxLength('500'), { value: 500 });
  for (const bad of ['0', '1.5', 'ten', '10001']) assert('error' in parseMaxLength(bad), `"${bad}" is refused`);
});

test('questions: moving items and adding up marks', () => {
  assertEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assertEqual(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
  assertEqual(moveItem(['a', 'b'], 1, 1), ['a', 'b']);
  assertEqual(totalMarks([{ marks: 0.1 }, { marks: 0.2 }]), 0.3, 'no floating-point leftovers');
});

/* The registry ---------------------------------------------------------------- */
test('questions: every type is defined once, with what the editor needs', () => {
  assertEqual(TYPE_ORDER, ['multiple_choice', 'checkboxes', 'short_answer', 'paragraph']);
  for (const type of TYPE_ORDER) {
    const def = QUESTION_TYPES[type];
    assert(def.label && def.icon && def.summary && typeof def.editor === 'function' && typeof def.preview === 'function', `${type} is complete`);
  }
  const a = createQuestion('multiple_choice');
  const b = createQuestion('multiple_choice');
  assert(a.id !== b.id && a.options?.length === 2 && a.marks === 1, 'new choice questions: own id, two blank options, 1 mark');
  assertEqual(createQuestion('short_answer').acceptedAnswers, []);
  assertEqual(QUESTION_TYPES.short_answer.autoGraded(createQuestion('short_answer')), false, 'no accepted answers = graded by hand');
  assertEqual(QUESTION_TYPES.paragraph.autoGraded(createQuestion('paragraph')), false);
});

test('questions: validation says exactly what to fix', () => {
  assertEqual(codes(mc()), []);
  assertEqual(codes(createQuestion('multiple_choice')), ['error:text', 'error:option-empty', 'error:option-empty', 'error:correct']);
  assertEqual(codes(mc({ options: [{ id: 'a', text: 'Same', image: null, isCorrect: true }, { id: 'b', text: ' same', image: null, isCorrect: false }] })), ['warning:duplicate'], 'same text is a warning');
  assertEqual(codes(mc({ options: mc().options?.map((o) => ({ ...o, isCorrect: true })) })), ['error:correct'], 'multiple choice has one answer');
  assertEqual(codes(mc({ type: 'checkboxes', options: mc().options?.map((o) => ({ ...o, isCorrect: true })) })), [], 'checkboxes can have several');
  const tooMany = Array.from({ length: MAX_OPTIONS + 1 }, (_, i) => ({ ...blankOption(`O${i}`), isCorrect: i === 0 }));
  assertEqual(codes(mc({ options: tooMany })), ['error:options-max']);
  const withImage = mc({ options: [{ id: 'a', text: '', image: { assetId: 'x', url: 'u', alt: '', decorative: false }, isCorrect: true }, { id: 'b', text: 'B', image: null, isCorrect: false }] });
  const issues = validateQuestion(withImage);
  assertEqual(issues.map((i) => i.target), ['option-image:a'], 'an image-only option is fine, but needs alt text');
  assertEqual(codes(mc({ image: { assetId: 'x', url: 'u', alt: '', decorative: true } })), [], 'decorative images need no alt text');
  const short = { ...createQuestion('short_answer'), text: 'Capital?', acceptedAnswers: ['Abuja', 'abuja'] };
  assertEqual(codes(short), ['warning:accepted-duplicate']);
  assertEqual(codes({ ...short, caseSensitive: true }), [], 'with case sensitivity they differ');
});

test('questions: changing type keeps what fits and says what is lost', () => {
  const base = mc({ image: { assetId: 'img', url: 'u', alt: 'A logo', decorative: false }, explanation: 'Because.' });
  let out = convertQuestion(base, 'checkboxes');
  assertEqual(out.lost, []);
  assertEqual(out.question.options, base.options);
  assert(out.question.id === 'q1' && out.question.text === 'Pick one' && out.question.marks === 2 && out.question.image === base.image && out.question.explanation === 'Because.', 'text, marks, image and explanation stay');

  const multi = mc({ type: 'checkboxes', options: mc().options?.map((o) => ({ ...o, isCorrect: true })) });
  out = convertQuestion(multi, 'multiple_choice');
  assertEqual(out.question.options?.map((o) => o.isCorrect), [true, false], 'only the first correct answer stays');
  assert(out.lost[0].includes('1 option'), out.lost.join());

  out = convertQuestion(base, 'short_answer');
  assertEqual(out.question.acceptedAnswers, ['Alpha'], 'the correct option becomes an accepted answer');
  assert(!out.question.options && out.lost[0].startsWith('2 options'), out.lost.join());

  out = convertQuestion({ ...createQuestion('short_answer'), acceptedAnswers: ['UN'], caseSensitive: true }, 'checkboxes');
  assertEqual(out.question.options?.map((o) => [o.text, o.isCorrect]), [['UN', true], ['', false]], 'answers become correct options (at least 2)');
  assertEqual(out.lost, ['the case-sensitive setting']);

  out = convertQuestion({ ...createQuestion('paragraph'), gradingNotes: 'Look for X', maxLength: 300 }, 'short_answer');
  assertEqual([out.question.maxLength, out.lost], [300, ['the grading notes']]);
});

test('questions: a copy gets new ids for itself and its options', () => {
  const original = mc({ source: { bankQuestionId: 'bank-1', bankVersion: 2 } });
  const copy = copyQuestion(original);
  assert(copy.id !== original.id && copy.options?.every((o, i) => o.id !== original.options?.[i].id), 'new ids');
  assertEqual(copy.options?.map((o) => o.text), ['Alpha', 'Beta']);
  assertEqual(copy.source, null, 'a copy is not linked to the bank');
  copy.options?.[0] && (copy.options[0].text = 'Changed');
  assertEqual(original.options?.[0].text, 'Alpha', 'deep copy');
});

/* What gets saved ------------------------------------------------------------- */
test('questions: changes become server calls, most important first', () => {
  const a = mc({ id: 'a' });
  const b = mc({ id: 'b', text: 'Second' });
  const c = mc({ id: 'c', text: 'Third' });
  assertEqual(questionOps([a, b], [a, b]), []);
  assertEqual(questionOps([a, b], [{ ...a, text: ' Pick one ' }, b]), [], 'spaces around the text are not a change');
  const fresh = mc({ id: 'n', text: 'New' });
  const ops = questionOps([a, b, c], [{ ...c, text: 'Third!' }, fresh, b]);
  assertEqual(ops.map((op) => op.kind), ['delete', 'create', 'update', 'order']);
  const create = /** @type {any} */ (ops[1]);
  assertEqual(create.position, 2, 'created after the 1 server question before it');
  assertEqual(/** @type {any} */ (ops[3]).ids, ['c', 'n', 'b']);
  assertEqual(questionOps([a, b], [a]).map((op) => op.kind), ['delete'], 'removing the last one needs no new order');
});

test('questions: only the fields a type uses are sent, and never an image URL', () => {
  const body = questionToApi(mc({ text: '  Pick one \r\n', image: { assetId: 'img-1', url: 'https://x/y.png', alt: ' Logo ', decorative: false, placement: 'above', size: 'medium' } }));
  assertEqual(body.text, 'Pick one');
  assertEqual(body.image, { assetId: 'img-1', alt: 'Logo', decorative: false, placement: 'above', size: 'medium' });
  assert(!('acceptedAnswers' in body) && !('gradingNotes' in body) && Array.isArray(body.options), 'choice fields only');
  const short = questionToApi({ ...createQuestion('short_answer'), acceptedAnswers: ['  United   Nations ', ''], caseSensitive: false });
  assertEqual([short.acceptedAnswers, short.caseSensitive, 'options' in short], [['United Nations'], false, false]);
  assertEqual(imageToApi({ assetId: 'x', url: 'u', alt: 'ignored', decorative: true })?.alt, '', 'decorative images send no alt text');
  assertEqual(uploadFromApi({ asset: { id: 'a1', url: 'https://cdn/a1.webp' } }), { assetId: 'a1', url: 'https://cdn/a1.webp' });
});

test('questions: "Copy my changes" text includes every question', () => {
  const text = questionsToText([mc(), { ...createQuestion('short_answer'), text: 'Capital?', acceptedAnswers: ['Abuja'] }]);
  assert(text.includes('1. (Multiple choice, 2 marks) Pick one') && text.includes('[x] Alpha') && text.includes('[ ] Beta'), text);
  assert(text.includes('2. (Short answer, 1 mark) Capital?') && text.includes('Accepted answers: Abuja'), text);
});

test('publish checks: images still uploading or failed block publishing', () => {
  const quiz = { title: 'Q', description: 'D', instructions: 'I', questions: [mc()], settings: /** @type {any} */ ({ opensAt: null, closesAt: '2099-01-01T00:00:00Z' }) };
  assertEqual(publishIssues(quiz, { uploads: { pending: 2, failed: 1 } }).blockers.map((b) => b.id), ['uploading', 'upload-failed']);
  const issue = publishIssues({ ...quiz, questions: [mc({ text: '' })] }).blockers[0];
  assertEqual([issue.questionId, issue.target], ['q1', 'text'], 'each question issue knows where to go');
});

/* Autosave with several changes waiting ------------------------------------------ */
test('autosave: one save sends every waiting change, one at a time, in order', async () => {
  /** @type {string[]} */
  const sent = [];
  /** @type {string[]} */
  const statuses = [];
  const saver = createAutosave({
    fields: [],
    values: { items: ['a', 'b'] },
    version: 1,
    diff: (saved, current) => {
      const next = current.items.find((/** @type {string} */ item) => !saved.items.includes(item));
      return next ? { add: next } : null;
    },
    commit: (saved, change) => ({ items: [...saved.items, change.add] }),
    save: async (change, version) => { sent.push(`${change.add}@${version}`); return { version: version + 1 }; },
    classify: () => 'error',
    onChange: (state) => statuses.push(state.status)
  });
  saver.update('items', ['a', 'b', 'c', 'd', 'e']);
  const ok = await saver.flush();
  assert(ok, 'saved');
  assertEqual(sent, ['c@1', 'd@2', 'e@3'], 'each change carries the newest version');
  assertEqual(saver.state.status, 'saved');
  assertEqual(statuses.filter((status, i) => status !== statuses[i - 1]), ['dirty', 'saving', 'saved'], 'no flicker between the changes');
  assertEqual(saver.savedValues().items, ['a', 'b', 'c', 'd', 'e']);
  saver.destroy();
});

/* The demo server's question endpoints ------------------------------------------------ */
test('demo server: questions are created in place, retried safely, and version-checked', async () => {
  const KEY = 'jci-mock:session';
  const before = localStorage.getItem(KEY);
  localStorage.setItem(KEY, JSON.stringify({ admin: { id: 't', name: 'Test', email: 't@t.co', role: 'admin' } }));
  let quizId = '';
  try {
    const quiz = await mock.createQuiz({ title: 'Stage 4 test quiz' });
    quizId = quiz.id;
    const one = { ...mc({ id: crypto.randomUUID(), text: 'One' }) };
    const two = { ...mc({ id: crypto.randomUUID(), text: 'Two' }) };
    let now = await mock.createQuestion(quizId, one, { version: quiz.version, position: 1 });
    now = await mock.createQuestion(quizId, two, { version: now.version, position: 1 });
    assertEqual(now.questions.map((q) => q.text), ['Two', 'One'], 'position 1 puts it first');
    const again = await mock.createQuestion(quizId, two, { version: now.version - 1, position: 1 });
    assertEqual([again.version, again.questions.length], [now.version, 2], 'a retried create is not a duplicate');
    await assertRejects(() => mock.updateQuestion(quizId, { ...one, text: 'Stale' }, { version: now.version - 1 }),
      (e) => e instanceof ApiError && e.status === 409, 'stale version');
    await assertRejects(() => mock.updateQuestion(quizId, { ...one, marks: 0 }, { version: now.version }),
      (e) => e instanceof ApiError && e.status === 422 && Boolean(e.fieldErrors.marks), 'invalid marks');
    await assertRejects(() => mock.updateQuestion(quizId, { ...mc({ id: 'missing' }) }, { version: now.version }),
      (e) => e instanceof ApiError && e.status === 404 && e.code === 'QUESTION_NOT_FOUND', 'deleted elsewhere');
    await assertRejects(() => mock.reorderQuestions(quizId, [one.id], { version: now.version }),
      (e) => e instanceof ApiError && e.status === 409, 'an order that leaves a question out');
    now = await mock.reorderQuestions(quizId, [one.id, two.id], { version: now.version });
    assertEqual(now.questions.map((q) => q.text), ['One', 'Two']);
    now = await mock.deleteQuestion(quizId, two.id, { version: now.version });
    const gone = await mock.deleteQuestion(quizId, two.id, { version: now.version - 3 });
    assertEqual([gone.questions.length, gone.version], [1, now.version], 'deleting twice is fine');
  } finally {
    if (quizId) await mock.deleteQuiz(quizId).catch(() => {});
    if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
  }
});

test('demo server: locked and archived quizzes refuse question changes', async () => {
  const KEY = 'jci-mock:session';
  const before = localStorage.getItem(KEY);
  localStorage.setItem(KEY, JSON.stringify({ admin: { id: 't', name: 'Test', email: 't@t.co', role: 'admin' } }));
  try {
    const drafts = await mock.listQuizzes({ status: 'draft', pageSize: 50 });
    const locked = drafts.items.find((q) => q.attemptCount > 0);
    const archived = (await mock.listQuizzes({ status: 'archived', pageSize: 50 })).items[0];
    assert(Boolean(locked && archived), 'demo data has both');
    if (!locked || !archived) return;
    await assertRejects(() => mock.createQuestion(locked.id, mc({ id: crypto.randomUUID() }), { version: locked.version, position: 1 }),
      (e) => e instanceof ApiError && e.status === 422 && e.code === 'QUESTIONS_LOCKED', 'participants have started');
    await assertRejects(() => mock.createQuestion(archived.id, mc({ id: crypto.randomUUID() }), { version: archived.version, position: 1 }),
      (e) => e instanceof ApiError && e.code === 'READ_ONLY', 'archived');
  } finally {
    if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
  }
});
