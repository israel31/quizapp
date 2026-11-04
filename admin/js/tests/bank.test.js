// @ts-check
/**
 * Stages 7 and 8: the duplicate report, the Question Bank model (snapshots,
 * versions, differences, tags), its adapters, and the demo server's bank
 * rules (versions, usage, delete only when unused, archive, filters).
 */
import { test, assert, assertEqual, assertRejects } from './harness.js';
import { questionFromBank, bankDraftFromQuestion, questionDifferences, questionOps } from '../quiz/question-model.js';
import { copyNotes } from '../quiz/quiz-actions.js';
import { cleanTags, bankQuestionFromApi, bankQuestionToApi, bankListQueryToApi, bankTagsFromApi, duplicateFromApi } from '../api/adapters.js';
import { ApiError } from '../api/client.js';
import * as mock from '../api/mock/mock-api.js';

/** @typedef {import('../types.js').BankQuestion} BankQuestion */

/** @returns {BankQuestion} */
const bankQ = (/** @type {any} */ overrides = {}) => ({
  id: 'bank-1', type: 'multiple_choice', text: 'Pick one', explanation: null, marks: 2, image: null, appearance: { bold: true },
  options: [{ id: 'o1', text: 'Alpha', image: null, isCorrect: true }, { id: 'o2', text: 'Beta', image: null, isCorrect: false }],
  tags: ['Basics'], status: 'active', version: 3, usedInQuizCount: 2, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z',
  ...overrides
});

/* Stage 7: duplicate report ------------------------------------------------------- */
test('duplicate: the copy says what was cleared and what couldn’t be copied', () => {
  const settings = /** @type {any} */ ({ opensAt: '2026-11-01T09:00:00Z', closesAt: null, resultVisibility: 'after_close' });
  const notes = copyNotes({ settings }, [{ item: 'Question 2’s image', reason: 'the image file is no longer stored, so add it again.' }]);
  assertEqual(notes[0], 'Not copied: Question 2’s image. The image file is no longer stored, so add it again.');
  assert(notes.some((n) => n.includes('open and close times were cleared')), 'dates cleared');
  assert(notes.some((n) => n.includes('add a close time')), 'results timing needs a close time');
  assert(notes[notes.length - 1].includes('never copied'), 'attempts and results are never copied');
  assertEqual(copyNotes({ settings: /** @type {any} */ ({ opensAt: null, closesAt: null, resultVisibility: 'manual' }) }, []).length, 1, 'nothing extra to say');
  const parsed = duplicateFromApi({ quiz: { id: 'q', title: 'Copy of X', questions: [] }, not_copied: [{ item: 'X', reason: 'y' }, { reason: 'no item' }] });
  assertEqual([parsed.quiz.title, parsed.notCopied], ['Copy of X', [{ item: 'X', reason: 'y' }]]);
  assertEqual(duplicateFromApi({ id: 'q', title: 'Plain' }).notCopied, [], 'a plain quiz response works too');
});

/* Stage 8: the model ---------------------------------------------------------------- */
test('bank: adding to a quiz makes a linked snapshot with new ids', () => {
  const copy = questionFromBank(bankQ());
  assert(copy.id !== 'bank-1' && copy.options?.every((o) => o.id !== 'o1' && o.id !== 'o2'), 'new ids');
  assertEqual(copy.source, { bankQuestionId: 'bank-1', bankVersion: 3 });
  assertEqual([copy.text, copy.marks, copy.appearance], ['Pick one', 2, { bold: true }]);
  assert(!('tags' in copy) && !('usedInQuizCount' in copy) && !('version' in copy), 'bank-only fields left behind');
  const original = bankQ();
  const again = questionFromBank(original);
  /** @type {any} */ (again.options)[0].text = 'Changed';
  assertEqual(original.options?.[0].text, 'Alpha', 'the snapshot is a copy');
});

test('bank: saving a quiz question to the bank makes a fresh, unlinked draft', () => {
  const quizQ = /** @type {any} */ ({ ...questionFromBank(bankQ()), order: 4 });
  const draft = bankDraftFromQuestion(quizQ);
  assert(draft.id !== quizQ.id && !('source' in draft) && !('order' in draft), 'new id, no link, no order');
  assert(draft.options?.every((o, i) => o.id !== quizQ.options[i].id), 'new option ids');
});

test('bank: differences between versions are named in words', () => {
  const quizCopy = questionFromBank(bankQ());
  assertEqual(questionDifferences(quizCopy, bankQ()), [], 'same content');
  const changed = bankQ({ text: 'Pick ONE', marks: 3, options: [{ id: 'x', text: 'Alpha', image: null, isCorrect: false }, { id: 'y', text: 'Gamma', image: null, isCorrect: true }], explanation: 'Because.' });
  assertEqual(questionDifferences(quizCopy, changed), ['Question text', 'Marks', 'Options', 'Correct answers', 'Explanation']);
  assertEqual(questionDifferences(quizCopy, bankQ({ appearance: {} })), ['Appearance']);
});

test('bank: linking a question to the bank is saved as a change', () => {
  const q = questionFromBank(bankQ());
  const unlinked = { ...q, source: null };
  assertEqual(questionOps([unlinked], [q]).map((op) => op.kind), ['update'], '"Save to bank" links the quiz copy');
});

/* Stage 8: adapters --------------------------------------------------------------------- */
test('bank: tags are tidy (trimmed, no repeats, at most 10 of 30 characters)', () => {
  assertEqual(cleanTags(['  Leadership ', 'leadership', 'JCI   basics', '', 'x'.repeat(40)]), ['Leadership', 'JCI basics', 'x'.repeat(30)]);
  assertEqual(cleanTags(Array.from({ length: 14 }, (_, i) => `t${i}`)).length, 10);
  assertEqual(bankTagsFromApi({ items: ['b', 'A', 'a'] }), ['A', 'b'], 'sorted, repeats dropped');
});

test('bank: API shapes in and out', () => {
  const parsed = bankQuestionFromApi({ id: 'b', type: 'short_answer', text: 'Capital?', marks: 1, accepted_answers: ['Abuja'], tags: ['Geo'], status: 'archived', version: 4, used_in_quiz_count: 3, created_at: 'c', updated_at: 'u', order: 9, source: { bankQuestionId: 'x' } });
  assertEqual([parsed.status, parsed.version, parsed.usedInQuizCount, parsed.acceptedAnswers, parsed.updatedAt], ['archived', 4, 3, ['Abuja'], 'u']);
  assert(!('order' in parsed) && !('source' in parsed), 'no quiz-only fields');
  const body = bankQuestionToApi(/** @type {any} */ ({ ...questionFromBank(bankQ()) }), [' Tag ', 'tag']);
  assertEqual([body.tags, 'source' in body, body.text], [['Tag'], false, 'Pick one']);
  assertEqual(bankListQueryToApi({ q: '  lead ', type: 'paragraph', usage: 'unused' }), { q: 'lead', type: 'paragraph', tag: undefined, usage: 'unused', status: undefined, sort: undefined, page: 1, pageSize: 20 });
});

/* Stage 8: the demo server ------------------------------------------------------------------ */
test('demo server: versions, usage, delete rules and filters', async () => {
  const KEY = 'jci-mock:session';
  const before = localStorage.getItem(KEY);
  localStorage.setItem(KEY, JSON.stringify({ admin: { id: 't', name: 'Test', email: 't@t.co', role: 'admin' } }));
  /** @type {string | null} */
  let createdId = null;
  try {
    const draft = { ...bankDraftFromQuestion(/** @type {any} */ ({ ...questionFromBank(bankQ()), text: 'Stage 8 test question', order: 0 })) };
    const created = await mock.createBankQuestion(draft, { tags: ['Stage 8 test'] });
    createdId = created.id;
    assertEqual([created.version, created.usedInQuizCount, created.status], [1, 0, 'active']);
    const retried = await mock.createBankQuestion(draft, { tags: ['Stage 8 test'] });
    assertEqual(retried.id, created.id, 'a retried create is not a duplicate');

    const tagsOnly = await mock.updateBankQuestion(created.id, draft, { tags: ['Stage 8 test', 'Extra'], version: 1 });
    assertEqual(tagsOnly.version, 1, 'tags alone don’t make a new version');
    const v2 = await mock.updateBankQuestion(created.id, { ...draft, text: 'Stage 8 test question, edited' }, { tags: tagsOnly.tags, version: 1 });
    assertEqual(v2.version, 2, 'a content change makes version 2');
    await assertRejects(() => mock.updateBankQuestion(created.id, { ...draft, text: 'Stale' }, { tags: [], version: 1 }),
      (e) => e instanceof ApiError && e.status === 409, 'a stale version is refused');
    await assertRejects(() => mock.updateBankQuestion(created.id, { ...draft, text: '' }, { tags: [], version: 2 }),
      (e) => e instanceof ApiError && e.status === 422 && Boolean(e.fieldErrors.text), 'text is required');

    const found = await mock.listBankQuestions({ tag: 'stage 8 TEST', pageSize: 50 });
    assertEqual(found.items.map((q) => q.id), [created.id], 'tag filter ignores capitals');
    const unused = await mock.listBankQuestions({ usage: 'unused', q: 'edited', pageSize: 50 });
    assert(unused.items.some((q) => q.id === created.id), 'search and usage filter');

    const archived = await mock.archiveBankQuestion(created.id);
    assertEqual(archived.status, 'archived');
    assert(!(await mock.listBankQuestions({ pageSize: 50 })).items.some((q) => q.id === created.id), 'archived questions leave the active list');
    await assertRejects(() => mock.updateBankQuestion(created.id, { ...draft, text: 'x' }, { tags: [], version: 2 }),
      (e) => e instanceof ApiError && e.code === 'READ_ONLY', 'archived questions are read-only');
    await mock.restoreBankQuestion(created.id);

    const used = (await mock.listBankQuestions({ usage: 'used', pageSize: 50 })).items[0];
    assert(Boolean(used) && used.usedInQuizCount > 0, 'demo bank has a used question');
    await assertRejects(() => mock.deleteBankQuestion(used.id), (e) => e instanceof ApiError && e.code === 'IN_USE', 'used questions can’t be deleted');
    await mock.deleteBankQuestion(created.id);
    createdId = null;
    await assertRejects(() => mock.getBankQuestion(created.id), (e) => e instanceof ApiError && e.status === 404, 'deleted');
  } finally {
    if (createdId) await mock.deleteBankQuestion(createdId).catch(() => {});
    if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
  }
});
