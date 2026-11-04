// @ts-check
/**
 * Stage 9: Results helpers, the results adapters (both field styles), the
 * demo server's grading rules (standing in for the backend), and its
 * attempts endpoints, including how a saved grade changes the total.
 * Stage 10: the Dashboard adapter, the demo dashboard numbers and count-up.
 */
import { test, assert, assertEqual, assertRejects } from './harness.js';
import { timeTaken, percentOf, scoreText, gradingProgress, scoreState, parseGrade, RESULTS_LIST_SCHEMA, ATTEMPT_STATUS_META } from '../quiz/results-rules.js';
import { parseListState, listStateToSearch } from '../core/list-state.js';
import { attemptSummaryFromApi, attemptFromApi, attemptListQueryToApi, resultsSummaryFromApi, gradeToApi, participantFromApi, quizSummaryFromApi, quizListQueryToApi } from '../api/adapters.js';
import { needsGrader, autoMarks, recompute, markFinals } from '../api/mock/mock-grading.js';
import { ApiError } from '../api/client.js';
import * as mock from '../api/mock/mock-api.js';
import { loadAttempts } from '../api/mock/mock-store.js';
import { dashboardFromApi } from '../api/adapters.js';
import { countUp } from '../core/motion.js';

/* Helpers ---------------------------------------------------------------------------- */
test('results: time taken, percentages and score text', () => {
  assertEqual(timeTaken('2026-03-01T10:00:00Z', '2026-03-01T10:12:30Z'), '12 min 30 s');
  assertEqual(timeTaken('2026-03-01T10:00:00Z', '2026-03-01T11:05:00Z'), '1 h 5 min');
  assertEqual(timeTaken('2026-03-01T10:00:00Z', '2026-03-01T10:00:45Z'), '45 s');
  assertEqual(timeTaken('2026-03-01T10:00:00Z', '2026-03-01T10:20:00Z'), '20 min');
  assertEqual(timeTaken('2026-03-01T10:00:00Z', null), '', 'no time while in progress');
  assertEqual(timeTaken('2026-03-01T10:00:00Z', 'not a date'), '');
  assertEqual([percentOf(7.5, 12), percentOf(0, 12), percentOf(null, 12), percentOf(3, 0)], [62.5, 0, null, null]);
  assertEqual(percentOf(1, 3), 33.3, 'one decimal place');
  assertEqual([scoreText(7.5, 12), scoreText(null, 12), scoreText(0, 1)], ['7.5 / 12', '— / 12', '0 / 1']);
});

test('results: grading progress and provisional/final', () => {
  const answers = /** @type {any[]} */ ([
    { needsManualGrading: false, manualMarks: null },
    { needsManualGrading: true, manualMarks: 3 },
    { needsManualGrading: true, manualMarks: null },
    { needsManualGrading: true, manualMarks: 0 }
  ]);
  assertEqual(gradingProgress({ answers }), { graded: 2, total: 3 }, '0 marks still counts as graded');
  assertEqual(gradingProgress({ answers: [] }), { graded: 0, total: 0 });
  assertEqual([scoreState('graded'), scoreState('pending_grading'), scoreState('submitted'), scoreState('in_progress')], ['final', 'provisional', 'provisional', null]);
  assert(Object.values(ATTEMPT_STATUS_META).every((m) => m.label && m.icon), 'every status has words and an icon');
});

test('results: the grader’s marks are checked before saving', () => {
  assertEqual(parseGrade('3', 5), { value: 3 });
  assertEqual(parseGrade(' 2.5 ', 5), { value: 2.5 });
  assertEqual(parseGrade('2,5', 5), { value: 2.5 }, 'a decimal comma works too');
  assertEqual(parseGrade('0', 5), { value: 0 }, 'zero is a grade');
  assertEqual(parseGrade('5', 5), { value: 5 }, 'full marks');
  const error = (/** @type {string} */ text, /** @type {number} */ max) => {
    const result = parseGrade(text, max);
    return 'error' in result ? result.error : '';
  };
  assert(error('', 5).includes('Enter the marks'), 'empty');
  assert(error('abc', 5).includes('up to 2 decimal places'), 'not a number');
  assert(error('-1', 5).includes('up to 2 decimal places'), 'no negatives');
  assert(error('1.255', 5).includes('up to 2 decimal places'), 'at most 2 decimals');
  assertEqual(error('6', 5), 'This question is worth 5 marks at most.');
  assertEqual(error('2', 1), 'This question is worth 1 mark at most.');
});

test('results: list state keeps status and sort in the URL', () => {
  const state = parseListState('?q=ada&status=pending_grading&sort=score:desc&page=2', RESULTS_LIST_SCHEMA);
  assertEqual([state.q, state.filters.status, state.sort, state.page], ['ada', 'pending_grading', 'score:desc', 2]);
  const bad = parseListState('?status=hacked&sort=evil', RESULTS_LIST_SCHEMA);
  assertEqual([bad.filters.status, bad.sort], ['', 'submittedAt:desc'], 'unknown values fall back');
  assert(listStateToSearch(state, RESULTS_LIST_SCHEMA).includes('status=pending_grading'), 'status goes back into the URL');
});

/* Adapters ------------------------------------------------------------------------------ */
test('results adapters: camelCase and snake_case, participant or student or user', () => {
  const camel = attemptSummaryFromApi({ id: 'a1', quizId: 'q1', participant: { id: 'p1', name: 'Ada Obi', email: 'ada@x.test' }, attemptNumber: 2, status: 'graded', startedAt: '2026-03-01T10:00:00Z', submittedAt: '2026-03-01T10:20:00Z', score: 7.5, maxScore: 12, isFinal: true });
  const snake = attemptSummaryFromApi({ id: 'a1', quiz_id: 'q1', student: { id: 'p1', full_name: 'Ada Obi', email: 'ada@x.test' }, attempt_number: 2, status: 'graded', started_at: '2026-03-01T10:00:00Z', submitted_at: '2026-03-01T10:20:00Z', score: '7.5', max_score: 12, is_final: true });
  assertEqual(snake, camel, 'both styles give the same attempt');
  assertEqual(attemptSummaryFromApi({ user: { name: '', email: 'x@y.test' } }).participant.name, 'x@y.test', 'no name: use the email');
  assertEqual(participantFromApi(null).name, 'Unnamed participant');
  const odd = attemptSummaryFromApi({ status: 'weird', score: null });
  assertEqual([odd.status, odd.score, odd.submittedAt], ['submitted', null, null], 'unknown status, no score yet');
  assert(!('matric' in camel.participant) && Object.keys(camel.participant).length === 3, 'name and email only (plus id)');
});

test('results adapters: a full attempt, its answers and where to go next', () => {
  const attempt = attemptFromApi({ attempt: {
    id: 'a1', quiz: { id: 'q1', title: 'Mission', status: 'published' }, participant: { name: 'Ada', email: 'a@x.test' }, status: 'pending_grading', score: 3, max_score: 8,
    answers: [{ question_id: 'qa', selected_option_ids: [1], auto_marks: 1 }, { question_id: 'qb', text: '<b>hi</b>', manual_marks: null, needs_manual_grading: true, feedback: '' }],
    questions: [{ id: 'qb', type: 'paragraph', order: 1, text: 'B', marks: 4 }, { id: 'qa', type: 'multiple_choice', order: 0, text: 'A', marks: 1, options: [] }],
    navigation: { previous_id: 'a0', next_id: null, next_to_grade_id: 'a7' }
  } });
  assertEqual(attempt.quiz, { id: 'q1', title: 'Mission', status: 'published' });
  assertEqual(attempt.answers[0], { questionId: 'qa', selectedOptionIds: ['1'], text: null, autoMarks: 1, manualMarks: null, feedback: null, needsManualGrading: false });
  assertEqual([attempt.answers[1].text, attempt.answers[1].needsManualGrading, attempt.answers[1].feedback], ['<b>hi</b>', true, null], 'text is kept exactly (shown as plain text)');
  assertEqual(attempt.questions.map((q) => q.id), ['qa', 'qb'], 'questions in order');
  assertEqual(attempt.navigation, { previousId: 'a0', nextId: null, nextToGradeId: 'a7' });
  assertEqual(attemptFromApi({}).navigation, { previousId: null, nextId: null, nextToGradeId: null });
});

test('results adapters: query, summary and grade', () => {
  const query = attemptListQueryToApi({ q: '  ada ', status: 'graded', from: '2026-03-01', to: '2026-03-31', sort: 'score:desc', page: 2, pageSize: 50 });
  assertEqual([query.q, query.status, query.sort, query.page, query.pageSize], ['ada', 'graded', 'score:desc', 2, 50]);
  assertEqual(query.from, new Date('2026-03-01T00:00:00').toISOString(), 'from: start of the day, local time, sent as UTC');
  assertEqual(query.to, new Date('2026-03-31T23:59:59.999').toISOString(), 'to: end of the day');
  const empty = attemptListQueryToApi({ from: 'yesterday', to: '' });
  assertEqual([empty.q, empty.status, empty.from, empty.to], [undefined, undefined, undefined, undefined], 'bad dates are dropped');
  assertEqual(resultsSummaryFromApi({ summary: { attempt_count: 4, average_percent: 61.234, highest_percent: '90', lowest_percent: null, pending_grading: 2 } }),
    { attempts: 4, averagePercent: 61.2, highestPercent: 90, lowestPercent: null, pendingGrading: 2 });
  assertEqual(gradeToApi({ marks: 2.456, feedback: '  Good\r\nwork  ' }), { marks: 2.46, feedback: 'Good\nwork' });
  assertEqual(gradeToApi({ marks: 0, feedback: '   ' }), { marks: 0, feedback: null }, 'blank feedback is sent as null');
  assertEqual(quizSummaryFromApi({ id: 'q', pending_grading_count: 3 }).pendingGradingCount, 3);
  assertEqual(quizListQueryToApi({ hasAttempts: true }).hasAttempts, 'true');
});

/* The demo server's grading rules (the backend's job) ------------------------------------ */
const opt = (/** @type {string} */ id, /** @type {boolean} */ isCorrect) => ({ id, text: id, image: null, isCorrect });

test('demo grading: who needs a person, and automatic marks', () => {
  const mc = { type: 'multiple_choice', marks: 2, options: [opt('a', true), opt('b', false)] };
  const cb = { type: 'checkboxes', marks: 3, options: [opt('a', true), opt('b', true), opt('c', true), opt('d', false)] };
  const sa = { type: 'short_answer', marks: 1, acceptedAnswers: ['Active citizens'], caseSensitive: false };
  assertEqual([needsGrader(mc), needsGrader({ type: 'paragraph' }), needsGrader(sa), needsGrader({ type: 'short_answer', acceptedAnswers: [] })], [false, true, false, true]);
  const ans = (/** @type {string[]} */ ids, /** @type {string | null} */ text = null) => ({ selectedOptionIds: ids, text });
  const all = { checkboxScoring: 'all_or_nothing' };
  const part = { checkboxScoring: 'partial' };
  assertEqual([autoMarks(mc, ans(['a']), all), autoMarks(mc, ans(['b']), all), autoMarks(mc, ans([]), all), autoMarks(mc, ans(['a', 'b']), all)], [2, 0, 0, 0]);
  assertEqual([autoMarks(cb, ans(['a', 'b', 'c']), all), autoMarks(cb, ans(['a', 'b']), all), autoMarks(cb, ans(['a', 'b', 'c', 'd']), all)], [3, 0, 0], 'all or nothing');
  assertEqual([autoMarks(cb, ans(['a', 'b']), part), autoMarks(cb, ans(['a', 'b', 'd']), part), autoMarks(cb, ans(['d']), part)], [2, 1, 0], 'partial: wrong ticks take marks away, never below 0');
  assertEqual([autoMarks(sa, ans([], '  active   CITIZENS '), all), autoMarks(sa, ans([], 'citizens'), all), autoMarks(sa, ans([], ''), all)], [1, 0, 0], 'extra spaces and capitals ignored');
  assertEqual(autoMarks({ ...sa, caseSensitive: true }, ans([], 'active citizens'), all), 0, 'case-sensitive');
  assertEqual(autoMarks({ type: 'paragraph', marks: 5 }, ans([], 'text'), all), null, 'paragraphs wait for a person');
});

test('demo grading: totals, status and the attempt that counts', () => {
  const quiz = { settings: { checkboxScoring: 'all_or_nothing', attemptScoring: 'highest' }, questions: [
    { id: 'q1', type: 'multiple_choice', marks: 2, options: [opt('a', true), opt('b', false)] },
    { id: 'q2', type: 'paragraph', marks: 4 }
  ] };
  const attempt = /** @type {any} */ ({ status: 'submitted', participant: { id: 'p' }, submittedAt: '2026-03-01T10:00:00Z', answers: [
    { questionId: 'q1', selectedOptionIds: ['a'], text: null, manualMarks: null },
    { questionId: 'q2', selectedOptionIds: [], text: 'Essay', manualMarks: null }
  ] });
  recompute(attempt, quiz);
  assertEqual([attempt.score, attempt.maxScore, attempt.status], [2, 6, 'pending_grading'], 'provisional while the essay waits');
  attempt.answers[1].manualMarks = 3.5;
  recompute(attempt, quiz);
  assertEqual([attempt.score, attempt.status], [5.5, 'graded'], 'final once graded');
  const running = recompute({ status: 'in_progress', answers: [] }, quiz);
  assertEqual([running.score, running.status], [null, 'in_progress'], 'no score while in progress');

  const tries = [
    { participant: { id: 'p' }, status: 'graded', score: 5, submittedAt: '2026-03-01T10:00:00Z' },
    { participant: { id: 'p' }, status: 'graded', score: 3, submittedAt: '2026-03-02T10:00:00Z' },
    { participant: { id: 'p' }, status: 'in_progress', score: null, submittedAt: null }
  ];
  assertEqual(markFinals(tries, quiz).map((a) => a.isFinal), [true, false, false], 'highest counts');
  assertEqual(markFinals(tries, { settings: { attemptScoring: 'latest' } }).map((a) => a.isFinal), [false, true, false], 'latest counts');
});

/* The demo server's endpoints ---------------------------------------------------------- */
test('demo server: attempts, summary and saving a grade', async () => {
  const SESSION = 'jci-mock:session';
  const ATTEMPTS = 'jci-mock:attempts';
  const session = localStorage.getItem(SESSION);
  localStorage.setItem(SESSION, JSON.stringify({ admin: { id: 't', name: 'Test', email: 't@t.co', role: 'admin' } }));
  loadAttempts();
  const before = localStorage.getItem(ATTEMPTS);
  try {
    const quizzes = await mock.listQuizzes({ status: 'any', hasAttempts: true, pageSize: 50 });
    assert(quizzes.items.length > 0 && quizzes.items.every((q) => q.attemptCount > 0), 'only quizzes with attempts');
    const quiz = quizzes.items.find((q) => q.pendingGradingCount > 0);
    assert(Boolean(quiz), 'a demo quiz has answers waiting for grading');
    if (!quiz) return;

    const waiting = await mock.listAttempts(quiz.id, { status: 'pending_grading', sort: 'submittedAt:asc', pageSize: 100 });
    assertEqual(waiting.total, quiz.pendingGradingCount, 'the list and the count agree');
    assert(waiting.items.every((a) => a.status === 'pending_grading'), 'status filter');
    const someone = waiting.items[0];
    const found = await mock.listAttempts(quiz.id, { q: someone.participant.email.toUpperCase(), pageSize: 100 });
    assert(found.items.some((a) => a.id === someone.id), 'search by email ignores capitals');
    const byScore = await mock.listAttempts(quiz.id, { sort: 'score:desc', status: 'graded', pageSize: 100 });
    const pcts = byScore.items.map((a) => (a.score ?? 0) / a.maxScore);
    assert(pcts.every((v, i) => i === 0 || pcts[i - 1] >= v), 'highest score first');
    const future = await mock.listAttempts(quiz.id, { from: '2999-01-01' });
    assertEqual(future.total, 0, 'date filter');

    const summary = await mock.getResultsSummary(quiz.id);
    assertEqual(summary.pendingGrading, quiz.pendingGradingCount);
    assert(summary.lowestPercent !== null && summary.highestPercent !== null && summary.lowestPercent <= summary.highestPercent, 'lowest ≤ highest');

    const attempt = await mock.getAttempt(someone.id);
    const answer = attempt.answers.find((a) => a.needsManualGrading && a.manualMarks === null);
    const question = attempt.questions.find((q) => q.id === answer?.questionId);
    assert(Boolean(answer && question), 'there’s an answer to grade');
    if (!answer || !question) return;
    assert(attempt.navigation.nextToGradeId !== attempt.id, 'next to grade is another attempt');

    await assertRejects(() => mock.gradeAnswer(attempt.id, question.id, { marks: question.marks + 1, feedback: '' }),
      (e) => e instanceof ApiError && e.status === 422 && Boolean(e.fieldErrors.marks), 'too many marks');
    await assertRejects(() => mock.gradeAnswer(attempt.id, question.id, { marks: 1, feedback: 'x'.repeat(1001) }),
      (e) => e instanceof ApiError && Boolean(e.fieldErrors.feedback), 'feedback too long');
    const auto = attempt.answers.find((a) => !a.needsManualGrading);
    if (auto) {
      await assertRejects(() => mock.gradeAnswer(attempt.id, auto.questionId, { marks: 0, feedback: '' }),
        (e) => e instanceof ApiError && e.code === 'AUTO_GRADED', 'automatic marks can’t be overridden');
    }
    await assertRejects(() => mock.gradeAnswer('missing', question.id, { marks: 0, feedback: '' }), (e) => e instanceof ApiError && e.status === 404, 'unknown attempt');
    await assertRejects(() => mock.gradeAnswer(attempt.id, question.id, { marks: 1, feedback: 'simulate:server-error' }), (e) => e instanceof ApiError && e.status === 500, 'simulated failure');

    const graded = await mock.gradeAnswer(attempt.id, question.id, { marks: question.marks, feedback: '  Well done.  ' });
    const saved = graded.answers.find((a) => a.questionId === question.id);
    assertEqual([saved?.manualMarks, saved?.feedback], [question.marks, 'Well done.'], 'the grade is stored');
    assertEqual(graded.score, Math.round(((attempt.score ?? 0) + question.marks) * 100) / 100, 'the server works out the new total');
    const left = graded.answers.filter((a) => a.needsManualGrading && a.manualMarks === null).length;
    assertEqual(graded.status, left ? 'pending_grading' : 'graded', 'status follows what’s left to grade');
    assertEqual((await mock.getAttempt(attempt.id)).score, graded.score, 'and it’s saved');

    const running = loadAttempts().find((a) => a.status === 'in_progress');
    if (running) {
      const q = running.answers[0]?.questionId || 'x';
      await assertRejects(() => mock.gradeAnswer(running.id, q, { marks: 0, feedback: '' }), (e) => e instanceof ApiError && e.code === 'NOT_SUBMITTED', 'in-progress attempts can’t be graded');
    }
  } finally {
    if (before !== null) localStorage.setItem(ATTEMPTS, before);
    if (session === null) localStorage.removeItem(SESSION); else localStorage.setItem(SESSION, session);
  }
});

/* Stage 10: the Dashboard ------------------------------------------------------------- */

test('dashboard adapter: both field styles; missing lists stay “not available”', () => {
  const camel = dashboardFromApi({
    totals: { quizzes: 11, published: 6, drafts: 5, archived: 2, attempts: 491 },
    pendingGrading: { attempts: 9, quizzes: [{ id: 'q1', title: 'A', count: 9 }] },
    closingSoon: [{ id: 'q2', title: 'B', closesAt: '2026-11-03T16:00:00Z' }],
    openingSoon: [],
    recentQuizzes: [{ id: 'q3', title: 'C', status: 'draft' }],
    recentSubmissions: [{ attemptId: 'a1', quizId: 'q1', quizTitle: 'A', participant: { name: 'Ada', email: 'a@x.test' }, submittedAt: '2026-11-01T08:00:00Z', status: 'graded', score: 7, maxScore: 10 }]
  });
  const snake = dashboardFromApi({ summary: {
    totals: { quiz_count: 11, published: 6, drafts: 5, archived: 2, attempt_count: 491 },
    pending_grading: { count: 9, quizzes: [{ quiz_id: 'q1', title: 'A', pending_grading: 9 }] },
    closing_soon: [{ id: 'q2', title: 'B', closes_at: '2026-11-03T16:00:00Z' }],
    opening_soon: [],
    recent_quizzes: [{ id: 'q3', title: 'C', status: 'draft' }],
    recent_submissions: [{ attempt_id: 'a1', quiz: { id: 'q1', title: 'A' }, student: { full_name: 'Ada', email: 'a@x.test' }, submitted_at: '2026-11-01T08:00:00Z', status: 'graded', score: '7', max_score: 10 }]
  } });
  assertEqual(snake.totals, camel.totals, 'totals');
  assertEqual(snake.pendingGrading, camel.pendingGrading, 'waiting for grading');
  assertEqual(snake.closingSoon, [{ id: 'q2', title: 'B', count: 0, at: '2026-11-03T16:00:00Z' }]);
  assertEqual(snake.recentSubmissions, camel.recentSubmissions, 'recent submissions');
  assertEqual(camel.recentQuizzes.map((q) => q.id), ['q3']);
  const bare = dashboardFromApi({ totals: { quizzes: 1 } });
  assertEqual([bare.pendingGrading, bare.closingSoon, bare.openingSoon, bare.recentSubmissions], [null, null, null, null], 'nothing is invented when the server leaves it out');
  assertEqual([bare.totals.quizzes, bare.totals.attempts, bare.recentQuizzes.length], [1, 0, 0]);
});

test('demo server: the dashboard numbers match the demo data', async () => {
  const SESSION = 'jci-mock:session';
  const session = localStorage.getItem(SESSION);
  localStorage.setItem(SESSION, JSON.stringify({ admin: { id: 't', name: 'Test', email: 't@t.co', role: 'admin' } }));
  try {
    const summary = await mock.getDashboardSummary();
    const all = await mock.listQuizzes({ status: 'any', pageSize: 100 });
    const count = (/** @type {string} */ status) => all.items.filter((q) => q.status === status).length;
    assertEqual([summary.totals.published, summary.totals.drafts, summary.totals.archived], [count('published'), count('draft'), count('archived')]);
    assertEqual(summary.totals.quizzes, count('published') + count('draft'), 'quizzes = drafts + published');
    assertEqual(summary.totals.attempts, all.items.reduce((sum, q) => sum + q.attemptCount, 0), 'every attempt counted');
    assertEqual(summary.pendingGrading?.attempts, all.items.reduce((sum, q) => sum + q.pendingGradingCount, 0), 'waiting for grading');
    const counts = (summary.pendingGrading?.quizzes || []).map((q) => q.count);
    assert(counts.every((c, i) => i === 0 || counts[i - 1] >= c), 'busiest quiz first');
    const now = Date.now();
    assert((summary.closingSoon || []).every((q) => q.at && Date.parse(q.at) > now && Date.parse(q.at) - now <= 72 * 3600e3), 'closing within 72 hours');
    assert((summary.openingSoon || []).every((q) => q.at && Date.parse(q.at) > now && Date.parse(q.at) - now <= 7 * 24 * 3600e3), 'opening within 7 days');
    assert(summary.recentQuizzes.length === 5 && summary.recentQuizzes.every((q) => q.status !== 'archived'), 'five recent active quizzes');
    const times = summary.recentQuizzes.map((q) => Date.parse(q.updatedAt));
    assert(times.every((t, i) => i === 0 || times[i - 1] >= t), 'newest first');
    const subs = summary.recentSubmissions || [];
    assert(subs.length === 5 && subs.every((s) => s.submittedAt && s.quizTitle && s.participant.email), 'five recent submissions with quiz and participant');
  } finally {
    if (session === null) localStorage.removeItem(SESSION); else localStorage.setItem(SESSION, session);
  }
});

test('motion: count-up ends on the exact number', () => {
  const node = document.createElement('span');
  countUp(node, 491, { format: (n) => `${n}` });
  assert(node.textContent === '0' || node.textContent === '491', 'starts at 0 (or 491 with reduced motion)');
  const zero = document.createElement('span');
  countUp(zero, 0);
  assertEqual(zero.textContent, '0');
  const half = document.createElement('span');
  countUp(half, 2.5, { format: (n) => `${n}%` });
  assertEqual(half.textContent, '2.5%', 'decimals are shown as they are');
});
