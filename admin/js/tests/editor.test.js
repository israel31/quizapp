// @ts-check
/**
 * Stage 3: autosave, details validation, publish checks and the save endpoint.
 */
import { test, assert, assertEqual, assertRejects } from './harness.js';
import { createAutosave, diffFields, retryDelay, normalizeValue } from '../core/autosave.js';
import { validateQuizDetails } from '../quiz/quiz-rules.js';
import { publishIssues } from '../quiz/publish-checks.js';
import { quizPatchToApi } from '../api/adapters.js';
import { ApiError } from '../api/client.js';
import * as mock from '../api/mock/mock-api.js';

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FIELDS = ['title', 'description', 'instructions'];

/* Autosave building blocks ------------------------------------------------------ */
test('autosave: only changed fields are sent; spaces and line endings don’t count', () => {
  const saved = { title: 'Quiz', description: 'Old', instructions: 'A\nB' };
  assertEqual(diffFields(saved, { title: 'Quiz ', description: 'New', instructions: 'A\r\nB' }, FIELDS), { description: 'New' });
  assertEqual(diffFields(saved, saved, FIELDS), {});
  assertEqual(normalizeValue('  x\r\ny  '), 'x\ny');
});

test('autosave: retries wait 2, 4, 8, 16, then 30 seconds', () => {
  assertEqual([0, 1, 2, 3, 4, 5, 9].map(retryDelay), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

/** A small autosave with a scripted server. */
function harness(/** @type {(changes: Record<string, string>, version: number) => Promise<{ version: number }>} */ save) {
  /** @type {string[]} */
  const statuses = [];
  const saver = createAutosave({
    fields: FIELDS,
    values: { title: 'Quiz', description: '', instructions: '' },
    version: 1,
    delay: 30,
    validate: validateQuizDetails,
    save,
    classify: (error) => (error instanceof ApiError && error.status === 409 ? 'conflict' : error instanceof ApiError && error.status === 401 ? 'auth' : 'error'),
    onChange: (state) => statuses.push(state.status)
  });
  return { saver, statuses };
}

test('autosave: waits for a pause, sends the version, then reports saved', async () => {
  /** @type {any[]} */
  const calls = [];
  const { saver, statuses } = harness(async (changes, version) => { calls.push({ changes, version }); await sleep(5); return { version: version + 1 }; });
  saver.update('title', 'Biology');
  saver.update('title', 'Biology Mid-Term');
  assertEqual(calls.length, 0, 'nothing sent while typing');
  await sleep(120);
  assertEqual(calls, [{ changes: { title: 'Biology Mid-Term' }, version: 1 }], 'one save with the latest text');
  assertEqual(saver.state.status, 'saved');
  assertEqual(saver.version, 2);
  assert(statuses.includes('dirty') && statuses.includes('saving'), `went through dirty and saving: ${statuses.join(',')}`);
  saver.destroy();
});

test('autosave: never shows saved before the server confirms; edits during a save are saved next', async () => {
  /** @type {() => void} */
  let release = () => {};
  /** @type {any[]} */
  const calls = [];
  const { saver } = harness((changes, version) => { calls.push(changes); return new Promise((resolve) => { release = () => resolve({ version: version + 1 }); }); });
  saver.update('description', 'First');
  const first = saver.flush();
  await sleep(10);
  assertEqual(saver.state.status, 'saving');
  saver.update('description', 'Second');
  assert(saver.state.status === 'saving', 'still saving, not "saved"');
  release();
  await first;
  await sleep(80);
  release();
  await sleep(20);
  assertEqual(calls.map((c) => c.description), ['First', 'Second']);
  assertEqual(saver.state.status, 'saved');
  saver.destroy();
});

test('autosave: invalid values are not sent', async () => {
  let sent = 0;
  const { saver } = harness(async (_c, v) => { sent++; return { version: v + 1 }; });
  saver.update('title', '   ');
  const ok = await saver.flush();
  assert(!ok && sent === 0, 'blank title not sent');
  assertEqual(saver.state.status, 'invalid');
  assertEqual(saver.state.fieldErrors.title, 'Enter a title for the quiz');
  saver.update('title', 'Fixed');
  assertEqual(saver.state.status, 'dirty', 'fixing it clears the error straight away');
  saver.destroy();
});

test('autosave: a conflict stops saving until reset; a failure schedules a retry', async () => {
  let mode = 'conflict';
  let sent = 0;
  const { saver } = harness(async (_c, v) => {
    sent++;
    if (mode === 'conflict') throw new ApiError({ status: 409, code: 'VERSION_CONFLICT' });
    if (mode === 'down') throw new ApiError({ status: 503 });
    return { version: v + 1 };
  });
  saver.update('description', 'Mine');
  await saver.flush();
  assertEqual(saver.state.status, 'conflict');
  saver.update('description', 'Still mine');
  await sleep(80);
  assertEqual(sent, 1, 'no more saves during a conflict');
  assert(saver.hasUnsaved(), 'the change is kept in memory');
  saver.reset({ title: 'Quiz', description: 'Theirs', instructions: '' }, 5);
  assertEqual([saver.state.status, saver.version, saver.values().description], ['saved', 5, 'Theirs']);
  mode = 'down';
  saver.update('description', 'Again');
  await saver.flush();
  assertEqual(saver.state.status, 'error');
  assert(saver.state.retryAt > Date.now(), 'a retry is scheduled');
  mode = 'ok';
  assert(await saver.retry(), 'Retry saves once the server is back');
  saver.destroy();
});

/* Details validation ------------------------------------------------------------- */
test('details: title required, limits on every field', () => {
  assertEqual(validateQuizDetails({ title: 'Quiz', description: '', instructions: '' }), {});
  assertEqual(validateQuizDetails({ title: '' }).title, 'Enter a title for the quiz');
  assert(validateQuizDetails({ title: 'x'.repeat(121) }).title.includes('120 characters or fewer (currently 121)'), 'title limit');
  assert(Boolean(validateQuizDetails({ title: 'Q', description: 'x'.repeat(501) }).description), 'description limit');
  assert(Boolean(validateQuizDetails({ title: 'Q', instructions: 'x'.repeat(2001) }).instructions), 'instructions limit');
});

test('details: PATCH body has only changed fields plus the version', () => {
  assertEqual(quizPatchToApi({ title: '  Biology ' }, 7), { version: 7, title: 'Biology' });
  assertEqual(quizPatchToApi({ instructions: 'One\r\nTwo\n' }, 2), { version: 2, instructions: 'One\nTwo' });
});

/* Publish checks ------------------------------------------------------------------ */
/** @type {any} */
const settings = { durationMinutes: null, opensAt: null, closesAt: null, maxAttempts: 1, attemptScoring: 'highest', checkboxScoring: 'all_or_nothing', resultVisibility: 'immediately', showCorrectAnswers: false, shortAnswerCaseSensitive: false };
/** @param {any} overrides */
const question = (overrides) => ({ id: 'q', type: 'multiple_choice', order: 1, text: 'Pick one', explanation: null, marks: 2, image: null, appearance: {}, source: null,
  options: [{ id: 'a', text: 'A', image: null, isCorrect: true }, { id: 'b', text: 'B', image: null, isCorrect: false }], ...overrides });

test('publish checks: a complete quiz has no blockers', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const { blockers, warnings } = publishIssues({ title: 'Quiz', description: 'About', instructions: 'Go', questions: [question({})], settings: { ...settings, closesAt: '2026-11-30T12:00:00Z' } }, { now });
  assertEqual(blockers, []);
  assertEqual(warnings, []);
});

test('publish checks: every blocker the brief lists', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const ids = (/** @type {any} */ quiz) => publishIssues({ description: '', instructions: '', settings, ...quiz }, { now }).blockers.map((b) => b.id);
  assertEqual(ids({ title: ' ', questions: [] }), ['title', 'questions']);
  assertEqual(ids({ title: 'Q', questions: [question({ text: '' })] }), ['q1-text']);
  assertEqual(ids({ title: 'Q', questions: [question({ marks: 0 })] }), ['q1-marks']);
  assertEqual(ids({ title: 'Q', questions: [question({ options: [{ id: 'a', text: 'A', image: null, isCorrect: true }] })] }), ['q1-options']);
  assertEqual(ids({ title: 'Q', questions: [question({ options: [{ id: 'a', text: 'A', image: null, isCorrect: true }, { id: 'b', text: 'B', image: null, isCorrect: true }] })] }), ['q1-correct']);
  assertEqual(ids({ title: 'Q', questions: [question({ type: 'checkboxes', options: [{ id: 'a', text: 'A', image: null, isCorrect: false }, { id: 'b', text: 'B', image: null, isCorrect: false }] })] }), ['q1-correct']);
  assertEqual(ids({ title: 'Q', questions: [question({ image: { assetId: 'x', url: 'u', alt: '', decorative: false } })] }), ['q1-alt']);
  assertEqual(ids({ title: 'Q', questions: [question({ type: 'paragraph', options: undefined })], settings: { ...settings, opensAt: '2026-11-02T10:00:00Z', closesAt: '2026-11-01T10:00:00Z' } }), ['closes-before-opens']);
  assertEqual(ids({ title: 'Q', questions: [question({ type: 'short_answer', options: undefined, acceptedAnswers: [] })] }), [], 'no accepted answers just means graded by hand');
});

test('publish checks: warnings can be published anyway', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  const { warnings } = publishIssues({ title: 'Q', description: '', instructions: '', questions: [question({})], settings: { ...settings, opensAt: '2026-10-01T10:00:00Z' } }, { now });
  assertEqual(warnings.map((w) => w.id), ['description', 'instructions', 'no-close', 'opens-past']);
  assert(warnings.every((w) => w.tab), 'each warning says where to fix it');
});

/* The demo server's save endpoint ----------------------------------------------- */
test('demo server: save checks the version (409) and the fields (422)', async () => {
  const KEY = 'jci-mock:session';
  const before = localStorage.getItem(KEY);
  localStorage.setItem(KEY, JSON.stringify({ admin: { id: 't', name: 'Test', email: 't@t.co', role: 'admin' } }));
  try {
    const page = await mock.listQuizzes({ status: 'draft', pageSize: 50 });
    const quiz = await mock.getQuiz(page.items[0].id);
    await assertRejects(() => mock.updateQuiz(quiz.id, { title: 'x' }, { version: quiz.version - 1 }),
      (e) => e instanceof ApiError && e.status === 409, 'stale version');
    await assertRejects(() => mock.updateQuiz(quiz.id, { title: '' }, { version: quiz.version }),
      (e) => e instanceof ApiError && e.status === 422 && Boolean(e.fieldErrors.title), 'blank title');
    const saved = await mock.updateQuiz(quiz.id, { title: quiz.title }, { version: quiz.version });
    assertEqual(saved.version, quiz.version + 1, 'version goes up');
  } finally {
    if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
  }
});
