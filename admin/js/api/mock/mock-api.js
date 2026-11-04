// @ts-check
/**
 * DEMO MODE ONLY — a stand-in for the backend while it is being built.
 * Exports exactly the same functions as js/api/endpoints.js.
 *
 * This is NOT security and NOT real saving:
 * - Mock login accepts any email with any password of 8+ characters.
 * - The demo "session" is a flag in this browser's localStorage.
 * The real backend enforces sign-in, permissions and storage.
 */
import { CONFIG } from '../../config.js';
import { ApiError } from '../client.js';
import {
  adminFromApi, quizFromApi, quizPageFromApi, quizListQueryToApi, quizCreateToApi, quizPatchToApi,
  questionCreateToApi, questionUpdateToApi, questionOrderToApi, uploadFromApi, duplicateFromApi,
  bankQuestionFromApi, bankPageFromApi, bankListQueryToApi, bankQuestionToApi, bankTagsFromApi,
  attemptFromApi, attemptPageFromApi, attemptListQueryToApi, resultsSummaryFromApi, gradeToApi, dashboardFromApi,
  DEFAULT_SETTINGS, DEFAULT_APPEARANCE
} from '../adapters.js';
import { DEMO_ADMIN, DEMO_ERROR_PASSWORDS, DEMO_LIST_ERRORS } from './mock-data.js';
import { loadQuizzes, saveQuizzes, assetUrl, saveAsset, loadBank, saveBank, loadAttempts, saveAttempts } from './mock-store.js';
import { recompute, markFinals } from './mock-grading.js';
import { sanitizeAppearance } from '../../quiz/appearance.js';

/** @typedef {import('../../types.js').Admin} Admin */
/** @typedef {import('../../types.js').Quiz} Quiz */
/** @typedef {import('../../types.js').QuizSummary} QuizSummary */
/** @typedef {import('../../types.js').Question} Question */
/** @typedef {import('../../types.js').BankQuestion} BankQuestion */

const SESSION_KEY = 'jci-mock:session';

/**
 * Simulated network delay so loading states are visible. Cancelling (e.g. a
 * newer search) rejects straight away, like an aborted fetch.
 * @param {number} [min]
 * @param {number} [max]
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function delay(min = CONFIG.MOCK.minDelayMs, max = CONFIG.MOCK.maxDelayMs, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Request cancelled', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, min + Math.random() * (max - min));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

function readSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** @param {unknown} value */
function writeSession(value) {
  try {
    if (value === null) window.localStorage.removeItem(SESSION_KEY);
    else window.localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable: the demo session simply won't persist */
  }
}

/**
 * Same error format as the real backend's responses.
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {Record<string, string>} [fieldErrors]
 */
function fail(status, code, message, fieldErrors = {}) {
  return new ApiError({ status, code, message, fieldErrors, kind: 'http' });
}

/**
 * @param {{ identifier: string, password: string }} credentials
 * @returns {Promise<Admin>}
 */
export async function login({ identifier, password }) {
  await delay();
  if (password === DEMO_ERROR_PASSWORDS.networkFailure) {
    throw new ApiError({ code: 'NETWORK_ERROR', kind: 'network', message: 'Simulated network failure' });
  }
  if (password === DEMO_ERROR_PASSWORDS.tooManyAttempts) throw fail(429, 'RATE_LIMITED', 'Too many attempts');
  if (password === DEMO_ERROR_PASSWORDS.serverError) throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  if (password === DEMO_ERROR_PASSWORDS.wrongCredentials || password.length < 8) {
    throw fail(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  const admin = { ...DEMO_ADMIN, email: identifier.includes('@') ? identifier.trim() : DEMO_ADMIN.email };
  writeSession({ admin });
  return adminFromApi({ admin });
}

/** @returns {Promise<void>} */
export async function logout() {
  await delay(150, 350);
  writeSession(null);
}

/**
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Admin>}
 */
export async function getMe({ signal } = {}) {
  await delay(120, 320);
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  const session = readSession();
  if (!session) throw fail(401, 'UNAUTHORIZED', 'Not signed in');
  return adminFromApi(session);
}

// Quizzes (Stage 2) ----------------------------------------------------------------

function networkError() {
  return new ApiError({ code: 'NETWORK_ERROR', kind: 'network', message: 'Simulated network failure' });
}

/**
 * What the real backend would do before any admin call: no connection means
 * no answer, and no session means 401 (broadcast like client.js does).
 */
function guard() {
  if (!navigator.onLine) throw networkError();
  if (!readSession()) {
    window.dispatchEvent(new CustomEvent('api:unauthorized', { detail: { path: 'mock' } }));
    throw fail(401, 'UNAUTHORIZED', 'Not signed in');
  }
}

/** @param {any} quiz @param {number} [now] */
function availabilityOf(quiz, now = Date.now()) {
  if (quiz.status !== 'published') return null;
  const opens = quiz.settings.opensAt ? Date.parse(quiz.settings.opensAt) : null;
  const closes = quiz.settings.closesAt ? Date.parse(quiz.settings.closesAt) : null;
  if (opens !== null && opens > now) return 'scheduled';
  if (closes !== null && closes <= now) return 'closed';
  return 'open';
}

/** @param {any} quiz */
const totalMarksOf = (quiz) => quiz.questions.reduce((/** @type {number} */ sum, /** @type {any} */ q) => sum + (Number(q.marks) || 0), 0);

/** Server response for one quiz (API shape). @param {any} quiz */
function toApiQuiz(quiz) {
  return { ...quiz, availability: availabilityOf(quiz), totalMarks: totalMarksOf(quiz), questionCount: quiz.questions.length };
}

/** Server response for a list row (API shape, no questions). @param {any} quiz */
function toApiSummary(quiz) {
  const { questions, appearance, instructions, ...rest } = toApiQuiz(quiz);
  return rest;
}

/** @param {string} id */
function findQuiz(id) {
  const quiz = loadQuizzes().find((item) => item.id === id);
  if (!quiz) throw fail(404, 'NOT_FOUND', 'Quiz not found');
  return quiz;
}

/** @param {any} quiz */
function touch(quiz) {
  quiz.updatedAt = new Date().toISOString();
  quiz.version += 1;
  saveQuizzes();
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/** @param {string} text */
const normalize = (text) => text.toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();

/**
 * @param {any} a
 * @param {any} b
 * @param {string} sort  "field:asc|desc"
 */
function compareQuizzes(a, b, sort) {
  const [field, direction] = sort.split(':');
  const sign = direction === 'asc' ? 1 : -1;
  let result = 0;
  if (field === 'title') result = a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true });
  else if (field === 'attemptCount') result = a.attemptCount - b.attemptCount;
  else result = Date.parse(a[field]) - Date.parse(b[field]);
  return result * sign || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id);
}

/**
 * GET /admin/quizzes — search, filters, sorting and paging happen "on the server".
 * @param {{ q?: string, status?: string, availability?: string, sort?: string, page?: number, pageSize?: number, hasAttempts?: boolean }} [query]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../../types.js').Page<QuizSummary>>}
 */
export async function listQuizzes(query = {}, { signal } = {}) {
  const params = quizListQueryToApi(query);
  await delay(undefined, undefined, signal);
  guard();
  const q = normalize(params.q || '');
  if (q === DEMO_LIST_ERRORS.serverError) throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  if (q === DEMO_LIST_ERRORS.networkFailure) throw networkError();

  let items = loadQuizzes().map(toApiQuiz);
  if (params.status !== 'any') items = params.status ? items.filter((quiz) => quiz.status === params.status) : items.filter((quiz) => quiz.status !== 'archived');
  if (params.hasAttempts) items = items.filter((quiz) => quiz.attemptCount > 0);
  if (params.availability) items = items.filter((quiz) => quiz.status === 'published' && quiz.availability === params.availability);
  if (q) items = items.filter((quiz) => normalize(`${quiz.title} ${quiz.description}`).includes(q));
  items.sort((a, b) => compareQuizzes(a, b, params.sort || 'updatedAt:desc'));

  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || CONFIG.PAGE_SIZE_DEFAULT));
  const page = Math.max(1, Number(params.page) || 1);
  const start = (page - 1) * pageSize;
  const waiting = pendingCounts();
  return quizPageFromApi({
    items: items.slice(start, start + pageSize).map((quiz) => ({ ...toApiSummary(quiz), pendingGradingCount: waiting.get(quiz.id) || 0 })),
    page,
    pageSize,
    total: items.length
  });
}

/**
 * GET /admin/quizzes/{id}
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Quiz>}
 */
export async function getQuiz(id, { signal } = {}) {
  await delay(undefined, undefined, signal);
  guard();
  return quizFromApi(toApiQuiz(findQuiz(id)));
}

/**
 * POST /admin/quizzes — creates a draft.
 * @param {{ title: string }} input
 * @returns {Promise<Quiz>}
 */
export async function createQuiz(input) {
  const body = quizCreateToApi(input);
  await delay();
  guard();
  if (!body.title) throw fail(422, 'VALIDATION_ERROR', 'Check the quiz title.', { title: 'Enter a title for the quiz' });
  if (body.title.length > 120) {
    throw fail(422, 'VALIDATION_ERROR', 'Check the quiz title.', { title: `Title must be 120 characters or fewer (currently ${body.title.length})` });
  }
  const now = new Date().toISOString();
  const quiz = {
    id: newId(),
    title: body.title,
    description: '',
    instructions: '',
    status: 'draft',
    settings: { ...DEFAULT_SETTINGS },
    appearance: { ...DEFAULT_APPEARANCE },
    questions: [],
    attemptCount: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    publishedAt: null
  };
  loadQuizzes().unshift(quiz);
  saveQuizzes();
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * The server's publish checks (a subset of what Review & Publish shows).
 * @param {any} quiz
 * @returns {Record<string, string>}
 */
function publishProblems(quiz) {
  /** @type {Record<string, string>} */
  const problems = {};
  if (!String(quiz.title).trim()) problems.title = 'Add a title.';
  if (!quiz.questions.length) problems.questions = 'Add at least one question.';
  quiz.questions.forEach((/** @type {any} */ question, /** @type {number} */ index) => {
    const n = index + 1;
    if (!String(question.text).trim()) problems[`questions.${n}.text`] = `Question ${n} has no question text.`;
    if (!(Number(question.marks) > 0)) problems[`questions.${n}.marks`] = `Question ${n} needs marks above 0.`;
    if (question.type === 'multiple_choice' || question.type === 'checkboxes') {
      const options = question.options || [];
      if (options.length < 2 || options.some((/** @type {any} */ o) => !String(o.text).trim())) {
        problems[`questions.${n}.options`] = `Question ${n} needs at least 2 options, and none can be empty.`;
      }
      const correct = options.filter((/** @type {any} */ o) => o.isCorrect).length;
      if (question.type === 'multiple_choice' && correct !== 1) problems[`questions.${n}.correct`] = `Question ${n} needs exactly one correct answer.`;
      if (question.type === 'checkboxes' && correct === 0) problems[`questions.${n}.correct`] = `Question ${n} needs at least one correct answer.`;
    }
  });
  const { opensAt, closesAt, resultVisibility, maxAttempts } = quiz.settings;
  if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) problems['settings.closesAt'] = 'The close time must be after the open time.';
  else if (closesAt && Date.parse(closesAt) <= Date.now()) problems['settings.closesAt'] = 'The close time has already passed. Choose a new one in Settings.';
  if (resultVisibility === 'after_close' && !closesAt) problems['settings.resultVisibility'] = 'Results show after the quiz closes, but it has no close time. Fix this in Settings.';
  if (maxAttempts !== null && maxAttempts !== undefined && maxAttempts < 1) problems['settings.maxAttempts'] = 'Allow at least 1 attempt.';
  return problems;
}

/**
 * POST /admin/quizzes/{id}/publish
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function publishQuiz(id) {
  await delay();
  guard();
  const quiz = findQuiz(id);
  if (quiz.status !== 'draft') throw fail(422, 'INVALID_STATE', 'Only drafts can be published.');
  const problems = publishProblems(quiz);
  if (Object.keys(problems).length) throw fail(422, 'PUBLISH_BLOCKED', "This quiz isn't ready to publish yet.", problems);
  quiz.status = 'published';
  quiz.publishedAt = new Date().toISOString();
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * POST /admin/quizzes/{id}/unpublish — back to Draft; attempts in progress may finish.
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function unpublishQuiz(id) {
  await delay();
  guard();
  const quiz = findQuiz(id);
  if (quiz.status !== 'published') throw fail(422, 'INVALID_STATE', 'Only published quizzes can be unpublished.');
  quiz.status = 'draft';
  quiz.publishedAt = null;
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * POST /admin/quizzes/{id}/archive — hidden from active lists and read-only.
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function archiveQuiz(id) {
  await delay();
  guard();
  const quiz = findQuiz(id);
  if (quiz.status === 'archived') throw fail(422, 'INVALID_STATE', 'This quiz is already archived.');
  quiz.status = 'archived';
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * POST /admin/quizzes/{id}/restore — returns the quiz to Draft.
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function restoreQuiz(id) {
  await delay();
  guard();
  const quiz = findQuiz(id);
  if (quiz.status !== 'archived') throw fail(422, 'INVALID_STATE', 'Only archived quizzes can be restored.');
  quiz.status = 'draft';
  quiz.publishedAt = null;
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * DELETE /admin/quizzes/{id} — drafts with no attempts only.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteQuiz(id) {
  await delay();
  guard();
  const quiz = findQuiz(id);
  if (quiz.status !== 'draft') throw fail(422, 'INVALID_STATE', 'Only drafts can be deleted.');
  if (quiz.attemptCount > 0) throw fail(422, 'HAS_ATTEMPTS', 'Participants have already taken this quiz, so it can’t be deleted. Archive it instead.');
  const list = loadQuizzes();
  list.splice(list.findIndex((item) => item.id === quiz.id), 1);
  saveQuizzes();
}

/**
 * POST /admin/quizzes/{id}/duplicate — a NEW unpublished draft (section 23):
 * questions, options, answers, marks, images, appearance and reusable settings
 * are copied; attempts, results, status and open/close dates are not.
 * Anything that can't be copied (an image whose file is gone) is listed in
 * `notCopied` instead of being dropped silently.
 * @param {string} id
 * @returns {Promise<{ quiz: Quiz, notCopied: { item: string, reason: string }[] }>}
 */
export async function duplicateQuiz(id) {
  await delay();
  guard();
  const original = findQuiz(id);
  const titles = new Set(loadQuizzes().map((quiz) => quiz.title));
  const base = `Copy of ${original.title}`.slice(0, 120);
  let title = base;
  for (let n = 2; titles.has(title); n += 1) title = `${base} (${n})`;

  const now = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(original));
  Object.assign(copy, {
    id: newId(),
    title,
    status: 'draft',
    attemptCount: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    settings: { ...copy.settings, opensAt: null, closesAt: null }
  });
  /** @type {{ item: string, reason: string }[]} */
  const notCopied = [];
  const gone = 'the image file is no longer stored, so add it again.';
  copy.questions.forEach((/** @type {any} */ question, /** @type {number} */ index) => {
    question.id = newId();
    if (question.image && !assetUrl(String(question.image.assetId))) {
      question.image = null;
      notCopied.push({ item: `Question ${index + 1}’s image`, reason: gone });
    }
    (question.options || []).forEach((/** @type {any} */ option, /** @type {number} */ o) => {
      option.id = newId();
      if (option.image && !assetUrl(String(option.image.assetId))) {
        option.image = null;
        notCopied.push({ item: `The image on option ${o + 1} of question ${index + 1}`, reason: gone });
      }
    });
  });
  loadQuizzes().unshift(copy);
  saveQuizzes();
  return duplicateFromApi({ quiz: toApiQuiz(copy), notCopied });
}

/** Server-side limits for quiz details (the editor checks them first, for usability). */
const DETAIL_LIMITS = { title: 120, description: 500, instructions: 2000 };

/**
 * PATCH /admin/quizzes/{id}
 * Demo extras: text containing "simulate:server-error" or "simulate:offline"
 * fails that way, so the editor's error handling can be tried.
 * @param {string} id
 * @param {Parameters<typeof quizPatchToApi>[0]} changes
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function updateQuiz(id, changes, { version }) {
  const body = quizPatchToApi(changes, version);
  await delay(280, 650);
  guard();
  const text = Object.values(body).filter((v) => typeof v === 'string').join(' ').toLowerCase();
  if (text.includes(DEMO_LIST_ERRORS.serverError)) throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  if (text.includes(DEMO_LIST_ERRORS.networkFailure)) throw networkError();

  const quiz = findQuiz(id);
  if (quiz.status === 'archived') throw fail(422, 'READ_ONLY', 'This quiz is archived, so it can’t be changed. Restore it first.');
  if (body.version !== quiz.version) throw fail(409, 'VERSION_CONFLICT', 'This quiz was changed somewhere else.');

  /** @type {Record<string, string>} */
  const fieldErrors = {};
  for (const [key, max] of Object.entries(DETAIL_LIMITS)) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') fieldErrors[key] = 'This must be text.';
    else if (key === 'title' && !value) fieldErrors.title = 'Enter a title for the quiz';
    else if (value.length > max) fieldErrors[key] = `Must be ${max} characters or fewer (currently ${value.length})`;
  }
  if (Object.keys(fieldErrors).length) throw fail(422, 'VALIDATION_ERROR', 'Some details need fixing.', fieldErrors);

  if (body.settings) Object.assign(fieldErrors, settingsErrors(/** @type {any} */ (body.settings), quiz));
  if (body.appearance) Object.assign(fieldErrors, appearanceErrors(/** @type {any} */ (body.appearance)));
  if (Object.keys(fieldErrors).length) {
    const locked = Object.values(fieldErrors).some((m) => m.startsWith('Participants have started'));
    throw fail(422, locked ? 'SETTINGS_LOCKED' : 'VALIDATION_ERROR', locked ? 'Participants have started this quiz, so this setting can’t change.' : 'Some settings need fixing.', fieldErrors);
  }

  for (const key of Object.keys(DETAIL_LIMITS)) {
    if (typeof body[key] === 'string') quiz[key] = body[key];
  }
  if (body.settings) quiz.settings = { ...quiz.settings, .../** @type {any} */ (body.settings) };
  if (body.appearance) quiz.appearance = sanitizeAppearance(body.appearance);
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

const SETTING_ENUMS = {
  attemptScoring: ['highest', 'latest'],
  checkboxScoring: ['all_or_nothing', 'partial'],
  resultVisibility: ['immediately', 'after_close', 'manual']
};

/**
 * The server's checks on settings: types and ranges, and what may change once
 * participants have started (a later close time, result visibility and showing
 * correct answers only). Publishing rules are checked when publishing.
 * @param {any} s
 * @param {any} quiz
 * @returns {Record<string, string>}
 */
function settingsErrors(s, quiz) {
  /** @type {Record<string, string>} */
  const errors = {};
  const isWhole = (/** @type {unknown} */ v, /** @type {number} */ min, /** @type {number} */ max) => Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max;
  if (s.durationMinutes !== null && !isWhole(s.durationMinutes, 1, 600)) errors['settings.durationMinutes'] = 'The time limit must be 1 to 600 minutes.';
  for (const key of ['opensAt', 'closesAt']) {
    if (s[key] !== null && Number.isNaN(Date.parse(s[key]))) errors[`settings.${key}`] = 'Use a valid date and time.';
  }
  if (s.maxAttempts !== null && !isWhole(s.maxAttempts, 1, 20)) errors['settings.maxAttempts'] = 'Allow 1 to 20 attempts, or unlimited.';
  for (const [key, allowed] of Object.entries(SETTING_ENUMS)) {
    if (!allowed.includes(s[key])) errors[`settings.${key}`] = 'Choose one of the options.';
  }
  if (quiz.attemptCount > 0) {
    const saved = quiz.settings;
    for (const key of ['durationMinutes', 'opensAt', 'maxAttempts', 'attemptScoring', 'checkboxScoring', 'shortAnswerCaseSensitive']) {
      if ((s[key] ?? null) !== (saved[key] ?? null)) errors[`settings.${key}`] = 'Participants have started this quiz, so this setting is locked.';
    }
    if ((s.closesAt ?? null) !== (saved.closesAt ?? null)) {
      if (!saved.closesAt || !s.closesAt || Date.parse(s.closesAt) < Date.parse(saved.closesAt)) {
        errors['settings.closesAt'] = 'Participants have started this quiz, so the close time can only move later.';
      }
    }
  }
  return errors;
}

/** @param {any} a @returns {Record<string, string>} */
function appearanceErrors(a) {
  const clean = sanitizeAppearance(a);
  /** @type {Record<string, string>} */
  const errors = {};
  for (const key of Object.keys(clean)) {
    if (a[key] === undefined || String(a[key]).toUpperCase() !== String(/** @type {any} */ (clean)[key]).toUpperCase()) errors[`appearance.${key}`] = 'This value isn’t one of the options.';
  }
  return errors;
}

// Questions (Stage 4) ----------------------------------------------------------------

const QUESTION_TYPES = ['multiple_choice', 'checkboxes', 'short_answer', 'paragraph'];
const QUESTION_LIMITS = { text: 2000, option: 300, explanation: 1000, accepted: 100, gradingNotes: 2000, options: 10, accepted_count: 20 };

/**
 * The checks every question call makes before changing anything:
 * archived → read-only; participants have started → questions are locked.
 * @param {string} quizId
 */
function questionQuiz(quizId) {
  const quiz = findQuiz(quizId);
  if (quiz.status === 'archived') throw fail(422, 'READ_ONLY', 'This quiz is archived, so it can’t be changed. Restore it first.');
  if (quiz.attemptCount > 0) throw fail(422, 'QUESTIONS_LOCKED', 'Participants have started this quiz, so its questions are locked.');
  return quiz;
}

/** @param {any} quiz @param {number} version */
function checkVersion(quiz, version) {
  if (version !== quiz.version) throw fail(409, 'VERSION_CONFLICT', 'This quiz was changed somewhere else.');
}

/** Demo extras: question text containing a simulate: phrase fails that way. @param {any} body */
function simulateFailures(body) {
  const text = JSON.stringify(body).toLowerCase();
  if (text.includes(DEMO_LIST_ERRORS.serverError)) throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  if (text.includes(DEMO_LIST_ERRORS.networkFailure)) throw networkError();
}

/**
 * The server's own checks on a question's shape. Drafts may be unfinished
 * (no text yet, no correct answer), but never malformed.
 * @param {any} q
 */
function validateApiQuestion(q) {
  /** @type {Record<string, string>} */
  const errors = {};
  if (!q || typeof q !== 'object' || typeof q.id !== 'string' || !q.id) errors.id = 'Each question needs an id.';
  if (!QUESTION_TYPES.includes(q?.type)) errors.type = 'Unknown question type.';
  if (typeof q?.text !== 'string' || q.text.length > QUESTION_LIMITS.text) errors.text = `Question text must be ${QUESTION_LIMITS.text} characters or fewer.`;
  const marks = Number(q?.marks);
  if (!(marks > 0) || marks > 1000 || Math.round(marks * 100) !== marks * 100) errors.marks = 'Marks must be more than 0, up to 1000, with at most 2 decimal places.';
  if (q?.explanation && String(q.explanation).length > QUESTION_LIMITS.explanation) errors.explanation = `Explanation must be ${QUESTION_LIMITS.explanation} characters or fewer.`;
  /** @param {any} image @param {string} key */
  const checkImage = (image, key) => {
    if (!image) return;
    if (!assetUrl(String(image.assetId))) errors[key] = 'This image wasn’t found. Upload it again.';
  };
  checkImage(q?.image, 'image');
  if (q?.type === 'multiple_choice' || q?.type === 'checkboxes') {
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length > QUESTION_LIMITS.options) errors.options = `Use ${QUESTION_LIMITS.options} options or fewer.`;
    options.forEach((/** @type {any} */ o, /** @type {number} */ i) => {
      if (typeof o.id !== 'string' || !o.id) errors[`options.${i}.id`] = 'Each option needs an id.';
      if (String(o.text ?? '').length > QUESTION_LIMITS.option) errors[`options.${i}.text`] = `Option ${i + 1} must be ${QUESTION_LIMITS.option} characters or fewer.`;
      checkImage(o.image, `options.${i}.image`);
    });
  }
  if (q?.type === 'short_answer') {
    const answers = Array.isArray(q.acceptedAnswers) ? q.acceptedAnswers : [];
    if (answers.length > QUESTION_LIMITS.accepted_count) errors.acceptedAnswers = `Use ${QUESTION_LIMITS.accepted_count} accepted answers or fewer.`;
    if (answers.some((/** @type {any} */ a) => String(a).length > QUESTION_LIMITS.accepted)) errors.acceptedAnswers = `Accepted answers must be ${QUESTION_LIMITS.accepted} characters or fewer.`;
  }
  if (q?.type === 'paragraph' && String(q.gradingNotes ?? '').length > QUESTION_LIMITS.gradingNotes) errors.gradingNotes = `Grading notes must be ${QUESTION_LIMITS.gradingNotes} characters or fewer.`;
  if (Object.keys(errors).length) throw fail(422, 'VALIDATION_ERROR', 'This question couldn’t be saved. Check it and try again.', errors);
}

/** How the "database" keeps a question: image URLs come from the stored asset. @param {any} q @param {number} order */
function storedQuestion(q, order) {
  /** @param {any} image */
  const withUrl = (image) => (image ? { ...image, url: assetUrl(String(image.assetId)) || '' } : null);
  const stored = { ...JSON.parse(JSON.stringify(q)), order, image: withUrl(q.image) };
  if (Array.isArray(stored.options)) stored.options = stored.options.map((/** @type {any} */ o) => ({ ...o, image: withUrl(o.image) }));
  return stored;
}

/** Content only, for "is this request already applied?" checks. @param {any} q */
const sameContent = (q) => {
  const { order, ...rest } = q;
  const strip = (/** @type {any} */ image) => (image ? { ...image, url: undefined } : null);
  return JSON.stringify({ ...rest, image: strip(rest.image), options: rest.options?.map((/** @type {any} */ o) => ({ ...o, image: strip(o.image) })) });
};

/** @param {any} quiz */
function renumber(quiz) {
  quiz.questions.forEach((/** @type {any} */ q, /** @type {number} */ i) => { q.order = i + 1; });
}

/**
 * POST /admin/quizzes/{id}/questions
 * Safe to retry: if a question with this id already exists with the same
 * content, the request has already been applied and the quiz is returned.
 * @param {string} quizId
 * @param {Question} question
 * @param {{ version: number, position: number }} options
 * @returns {Promise<Quiz>}
 */
export async function createQuestion(quizId, question, { version, position }) {
  const body = questionCreateToApi(question, { version, position });
  await delay(240, 560);
  guard();
  simulateFailures(body);
  const quiz = questionQuiz(quizId);
  const existing = quiz.questions.find((/** @type {any} */ q) => q.id === body.question.id);
  if (existing && sameContent(existing) === sameContent(storedQuestion(body.question, 0))) return quizFromApi(toApiQuiz(quiz));
  if (existing) throw fail(409, 'VERSION_CONFLICT', 'A question with this id already exists.');
  checkVersion(quiz, body.version);
  validateApiQuestion(body.question);
  const at = Math.max(0, Math.min(Number(body.position) - 1, quiz.questions.length));
  quiz.questions.splice(at, 0, storedQuestion(body.question, 0));
  renumber(quiz);
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * PUT /admin/quizzes/{id}/questions/{questionId}
 * @param {string} quizId
 * @param {Question} question
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function updateQuestion(quizId, question, { version }) {
  const body = questionUpdateToApi(question, version);
  await delay(240, 560);
  guard();
  simulateFailures(body);
  const quiz = questionQuiz(quizId);
  const index = quiz.questions.findIndex((/** @type {any} */ q) => q.id === body.question.id);
  if (index < 0) throw fail(404, 'QUESTION_NOT_FOUND', 'This question was deleted somewhere else.');
  const next = storedQuestion(body.question, quiz.questions[index].order);
  if (sameContent(quiz.questions[index]) === sameContent(next)) return quizFromApi(toApiQuiz(quiz));   // already saved (a retry)
  checkVersion(quiz, body.version);
  validateApiQuestion(body.question);
  quiz.questions[index] = next;
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * DELETE /admin/quizzes/{id}/questions/{questionId}?version=
 * Deleting a question that's already gone succeeds (safe to retry).
 * @param {string} quizId
 * @param {string} questionId
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function deleteQuestion(quizId, questionId, { version }) {
  await delay(220, 480);
  guard();
  const quiz = questionQuiz(quizId);
  const index = quiz.questions.findIndex((/** @type {any} */ q) => q.id === questionId);
  if (index < 0) return quizFromApi(toApiQuiz(quiz));
  checkVersion(quiz, version);
  quiz.questions.splice(index, 1);
  renumber(quiz);
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

/**
 * PUT /admin/quizzes/{id}/question-order — must list exactly the quiz's questions.
 * @param {string} quizId
 * @param {string[]} questionIds
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function reorderQuestions(quizId, questionIds, { version }) {
  const body = questionOrderToApi(questionIds, version);
  await delay(220, 480);
  guard();
  const quiz = questionQuiz(quizId);
  const current = quiz.questions.map((/** @type {any} */ q) => q.id);
  if (current.join('|') === body.questionIds.join('|')) return quizFromApi(toApiQuiz(quiz));
  checkVersion(quiz, body.version);
  if (current.length !== body.questionIds.length || current.some((/** @type {string} */ id) => !body.questionIds.includes(id))) {
    throw fail(409, 'VERSION_CONFLICT', 'The questions were changed somewhere else.');
  }
  quiz.questions.sort((/** @type {any} */ a, /** @type {any} */ b) => body.questionIds.indexOf(a.id) - body.questionIds.indexOf(b.id));
  renumber(quiz);
  touch(quiz);
  return quizFromApi(toApiQuiz(quiz));
}

// Uploads (Stage 4) ------------------------------------------------------------------

/**
 * Demo copy of an uploaded image: resized to fit 1000 px, kept as a data URL
 * in this browser's demo storage. The real backend stores the original.
 * @param {File} file
 * @returns {Promise<string>}
 */
async function demoImageUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw fail(500, 'SERVER_ERROR', 'Couldn’t read this image.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/webp', 0.84);
}

/**
 * POST /admin/uploads — with simulated progress. A file whose name contains
 * "simulate-error" fails part-way, so the retry state can be tried.
 * @param {File} file
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<{ assetId: string, url: string }>}
 */
export async function uploadImage(file, { onProgress, signal } = {}) {
  if (!navigator.onLine) {
    await delay(200, 300, signal);
    throw networkError();
  }
  if (!(CONFIG.UPLOAD.acceptedTypes).includes(file.type)) {
    await delay(150, 250, signal);
    throw fail(422, 'UNSUPPORTED_FILE', 'Use a JPG, PNG or WebP image.');
  }
  if (file.size > CONFIG.UPLOAD.maxBytes) {
    await delay(150, 250, signal);
    throw fail(413, 'PAYLOAD_TOO_LARGE', 'This file is too large.');
  }
  const failPartWay = /simulate-error/i.test(file.name);
  const steps = 12;
  for (let step = 1; step <= steps; step += 1) {
    await delay(70, 140, signal);
    onProgress?.(Math.min(0.96, step / steps));
    if (failPartWay && step === 7) throw fail(500, 'SERVER_ERROR', 'Simulated upload failure');
  }
  guard();
  let url;
  try {
    url = await demoImageUrl(file);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw fail(422, 'UNSUPPORTED_FILE', 'This image couldn’t be read. Try another file.');
  }
  if (signal?.aborted) throw new DOMException('Upload cancelled', 'AbortError');
  const assetId = `asset-${newId()}`;
  saveAsset(assetId, url);
  onProgress?.(1);
  return uploadFromApi({ assetId, url });
}

// Question Bank (Stage 8) ----------------------------------------------------------------

/** How many quizzes use each bank question (any copy with that source). */
function bankUsage() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const quiz of loadQuizzes()) {
    const ids = new Set(quiz.questions.map((/** @type {any} */ q) => q.source?.bankQuestionId).filter(Boolean));
    ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  }
  return counts;
}

/** @param {any} item @param {Map<string, number>} [counts] */
const toApiBank = (item, counts = bankUsage()) => ({ ...item, usedInQuizCount: counts.get(item.id) || 0 });

/** @param {string} id */
function findBank(id) {
  const item = loadBank().find((q) => q.id === id);
  if (!item) throw fail(404, 'BANK_QUESTION_NOT_FOUND', 'This bank question no longer exists.');
  return item;
}

/** The parts of a bank question that make a new version when they change. @param {any} q */
function bankContent(q) {
  const { tags, status, version, createdAt, updatedAt, usedInQuizCount, order, source, ...rest } = q;
  return sameContent({ ...rest, order: 0 });
}

/** @param {any} body */
function checkBankQuestion(body) {
  if (!String(body.text || '').trim()) throw fail(422, 'VALIDATION_ERROR', 'Add the question text.', { text: 'Add the question text.' });
  validateApiQuestion(body);
}

const BANK_SORTS = {
  'updatedAt:desc': (/** @type {any} */ a, /** @type {any} */ b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  'updatedAt:asc': (/** @type {any} */ a, /** @type {any} */ b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt),
  'text:asc': (/** @type {any} */ a, /** @type {any} */ b) => a.text.localeCompare(b.text, 'en', { sensitivity: 'base', numeric: true }),
  'text:desc': (/** @type {any} */ a, /** @type {any} */ b) => b.text.localeCompare(a.text, 'en', { sensitivity: 'base', numeric: true }),
  'usage:desc': (/** @type {any} */ a, /** @type {any} */ b) => b.usedInQuizCount - a.usedInQuizCount
};

/**
 * GET /admin/bank-questions — search (text, options, answers, tags), filters, sort, pages.
 * @param {{ q?: string, type?: string, tag?: string, usage?: string, status?: string, sort?: string, page?: number, pageSize?: number }} [query]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../../types.js').Page<BankQuestion>>}
 */
export async function listBankQuestions(query = {}, { signal } = {}) {
  const params = bankListQueryToApi(query);
  await delay(undefined, undefined, signal);
  guard();
  const search = normalize(params.q || '');
  if (search.includes(DEMO_LIST_ERRORS.serverError)) throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  if (search.includes(DEMO_LIST_ERRORS.networkFailure)) throw networkError();
  const counts = bankUsage();
  const status = params.status === 'archived' ? 'archived' : 'active';
  let items = loadBank().map((q) => toApiBank(q, counts)).filter((q) => q.status === status);
  if (params.type) items = items.filter((q) => q.type === params.type);
  if (params.tag) items = items.filter((q) => q.tags.some((/** @type {string} */ t) => normalize(t) === normalize(String(params.tag))));
  if (params.usage === 'used') items = items.filter((q) => q.usedInQuizCount > 0);
  if (params.usage === 'unused') items = items.filter((q) => q.usedInQuizCount === 0);
  if (search) {
    items = items.filter((q) => normalize([q.text, ...(q.options || []).map((/** @type {any} */ o) => o.text), ...(q.acceptedAnswers || []), ...q.tags].join(' ')).includes(search));
  }
  const sort = /** @type {keyof typeof BANK_SORTS} */ (params.sort && params.sort in BANK_SORTS ? params.sort : 'updatedAt:desc');
  items.sort((a, b) => BANK_SORTS[sort](a, b) || a.id.localeCompare(b.id));
  const pageSize = Math.max(1, Number(params.pageSize) || CONFIG.PAGE_SIZE_DEFAULT);
  const page = Math.max(1, Number(params.page) || 1);
  return bankPageFromApi({ items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length });
}

/**
 * GET /admin/bank-questions/{id}
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<BankQuestion>}
 */
export async function getBankQuestion(id, { signal } = {}) {
  await delay(undefined, undefined, signal);
  guard();
  return bankQuestionFromApi(toApiBank(findBank(id)));
}

/**
 * POST /admin/bank-questions — version 1. Safe to retry (same id + content).
 * @param {Omit<Question, 'order' | 'source'>} question
 * @param {{ tags: string[] }} options
 * @returns {Promise<BankQuestion>}
 */
export async function createBankQuestion(question, { tags }) {
  const body = bankQuestionToApi(question, tags);
  await delay(260, 600);
  guard();
  simulateFailures(body);
  const existing = loadBank().find((q) => q.id === body.id);
  if (existing) {
    if (bankContent(existing) === bankContent(storedQuestion(body, 0))) return bankQuestionFromApi(toApiBank(existing));
    throw fail(409, 'CONFLICT', 'A bank question with this id already exists.');
  }
  checkBankQuestion(body);
  const now = new Date().toISOString();
  const { order, ...stored } = storedQuestion(body, 0);
  const item = { ...stored, tags: body.tags, status: 'active', version: 1, createdAt: now, updatedAt: now };
  loadBank().unshift(item);
  saveBank();
  return bankQuestionFromApi(toApiBank(item));
}

/**
 * PATCH /admin/bank-questions/{id} — new content = new version (future uses
 * only); tags alone don't make a new version. 409 on a stale version.
 * @param {string} id
 * @param {Omit<Question, 'order' | 'source'>} question
 * @param {{ tags: string[], version: number }} options
 * @returns {Promise<BankQuestion>}
 */
export async function updateBankQuestion(id, question, { tags, version }) {
  const body = bankQuestionToApi(question, tags);
  await delay(260, 600);
  guard();
  simulateFailures(body);
  const item = findBank(id);
  if (item.status === 'archived') throw fail(422, 'READ_ONLY', 'This question is archived. Restore it to make changes.');
  const { order, ...next } = storedQuestion({ ...body, id }, 0);
  const contentChanged = bankContent(item) !== bankContent(next);
  const tagsChanged = JSON.stringify(item.tags) !== JSON.stringify(body.tags);
  if (!contentChanged && !tagsChanged) return bankQuestionFromApi(toApiBank(item));   // already saved (a retry)
  if (version !== item.version) throw fail(409, 'VERSION_CONFLICT', 'This question was changed somewhere else.');
  checkBankQuestion({ ...body, id });
  const list = loadBank();
  const index = list.findIndex((q) => q.id === id);
  list[index] = { ...item, ...next, tags: body.tags, version: contentChanged ? item.version + 1 : item.version, updatedAt: new Date().toISOString() };
  saveBank();
  return bankQuestionFromApi(toApiBank(list[index]));
}

/**
 * DELETE /admin/bank-questions/{id} — only if no quiz has used it.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBankQuestion(id) {
  await delay();
  guard();
  const item = findBank(id);
  const used = bankUsage().get(id) || 0;
  if (used) throw fail(422, 'IN_USE', `This question is used in ${used} quiz${used === 1 ? '' : 'zes'}, so it can’t be deleted. Archive it instead.`);
  const list = loadBank();
  list.splice(list.findIndex((q) => q.id === item.id), 1);
  saveBank();
}

/** @param {string} id @param {'active' | 'archived'} status */
async function setBankStatus(id, status) {
  await delay();
  guard();
  const item = findBank(id);
  if (item.status === status) throw fail(422, 'INVALID_STATE', status === 'archived' ? 'This question is already archived.' : 'This question isn’t archived.');
  item.status = status;
  item.updatedAt = new Date().toISOString();
  saveBank();
  return bankQuestionFromApi(toApiBank(item));
}

/** POST /admin/bank-questions/{id}/archive @param {string} id @returns {Promise<BankQuestion>} */
export async function archiveBankQuestion(id) {
  return setBankStatus(id, 'archived');
}

/** POST /admin/bank-questions/{id}/restore @param {string} id @returns {Promise<BankQuestion>} */
export async function restoreBankQuestion(id) {
  return setBankStatus(id, 'active');
}

/**
 * GET /admin/bank-questions/tags
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string[]>}
 */
export async function listBankTags({ signal } = {}) {
  await delay(120, 260, signal);
  guard();
  return bankTagsFromApi(loadBank().flatMap((q) => q.tags));
}

// Results (Stage 9) ------------------------------------------------------------------

/** Attempts waiting for a grader, per quiz. */
function pendingCounts() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const attempt of loadAttempts()) {
    if (attempt.status === 'pending_grading') counts.set(attempt.quizId, (counts.get(attempt.quizId) || 0) + 1);
  }
  return counts;
}

/** A list row: everything except the answers. @param {any} attempt */
const toApiAttemptSummary = (attempt) => {
  const { answers, ...rest } = attempt;
  return rest;
};

/** @param {string} id */
function findAttempt(id) {
  const attempt = loadAttempts().find((a) => a.id === id);
  if (!attempt) throw fail(404, 'ATTEMPT_NOT_FOUND', 'This attempt no longer exists.');
  return attempt;
}

/** A quiz's attempts in the order graders move through them (first submitted first). @param {string} quizId */
function gradingOrder(quizId) {
  return loadAttempts()
    .filter((a) => a.quizId === quizId)
    .sort((a, b) => Date.parse(a.submittedAt || a.startedAt) - Date.parse(b.submittedAt || b.startedAt) || a.id.localeCompare(b.id));
}

/** One attempt in full: answers, the questions as seen (admin view), navigation. @param {any} attempt */
function toApiAttempt(attempt) {
  const quiz = findQuiz(attempt.quizId);
  const order = gradingOrder(attempt.quizId);
  const at = order.findIndex((a) => a.id === attempt.id);
  const waiting = order.filter((a) => a.status === 'pending_grading' && a.id !== attempt.id);
  const nextToGrade = waiting.find((a) => order.indexOf(a) > at) || waiting[0] || null;
  return {
    ...attempt,
    quiz: { id: quiz.id, title: quiz.title, status: quiz.status },
    questions: quiz.questions,
    navigation: {
      previousId: order[at - 1]?.id || null,
      nextId: order[at + 1]?.id || null,
      nextToGradeId: nextToGrade ? nextToGrade.id : null
    }
  };
}

const ATTEMPT_SORTS = {
  'submittedAt:desc': (/** @type {any} */ a, /** @type {any} */ b) => Date.parse(b.submittedAt || b.startedAt) - Date.parse(a.submittedAt || a.startedAt),
  'submittedAt:asc': (/** @type {any} */ a, /** @type {any} */ b) => Date.parse(a.submittedAt || a.startedAt) - Date.parse(b.submittedAt || b.startedAt),
  'score:desc': (/** @type {any} */ a, /** @type {any} */ b) => (b.score ?? -1) / (b.maxScore || 1) - (a.score ?? -1) / (a.maxScore || 1),
  'score:asc': (/** @type {any} */ a, /** @type {any} */ b) => (a.score ?? Infinity) / (a.maxScore || 1) - (b.score ?? Infinity) / (b.maxScore || 1),
  'name:asc': (/** @type {any} */ a, /** @type {any} */ b) => a.participant.name.localeCompare(b.participant.name, 'en', { sensitivity: 'base' })
};

/**
 * GET /admin/quizzes/{id}/attempts — search (name or email), status, dates, sort, pages.
 * @param {string} quizId
 * @param {{ q?: string, status?: string, from?: string, to?: string, sort?: string, page?: number, pageSize?: number }} [query]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../../types.js').Page<import('../../types.js').AttemptSummary>>}
 */
export async function listAttempts(quizId, query = {}, { signal } = {}) {
  const params = attemptListQueryToApi(query);
  await delay(undefined, undefined, signal);
  guard();
  findQuiz(quizId);
  const search = normalize(params.q || '');
  if (search.includes(DEMO_LIST_ERRORS.serverError)) throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  if (search.includes(DEMO_LIST_ERRORS.networkFailure)) throw networkError();
  let items = loadAttempts().filter((a) => a.quizId === quizId);
  if (params.status) items = items.filter((a) => a.status === params.status);
  if (search) items = items.filter((a) => normalize(`${a.participant.name} ${a.participant.email}`).includes(search));
  const when = (/** @type {any} */ a) => Date.parse(a.submittedAt || a.startedAt);
  if (params.from) items = items.filter((a) => when(a) >= Date.parse(String(params.from)));
  if (params.to) items = items.filter((a) => when(a) <= Date.parse(String(params.to)));
  const sort = /** @type {keyof typeof ATTEMPT_SORTS} */ (params.sort && params.sort in ATTEMPT_SORTS ? params.sort : 'submittedAt:desc');
  items = items.slice().sort((a, b) => ATTEMPT_SORTS[sort](a, b) || a.id.localeCompare(b.id));
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || CONFIG.PAGE_SIZE_DEFAULT));
  const page = Math.max(1, Number(params.page) || 1);
  return attemptPageFromApi({ items: items.slice((page - 1) * pageSize, page * pageSize).map(toApiAttemptSummary), page, pageSize, total: items.length });
}

/**
 * GET /admin/quizzes/{id}/results/summary — over submitted attempts only.
 * @param {string} quizId
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../../types.js').ResultsSummary>}
 */
export async function getResultsSummary(quizId, { signal } = {}) {
  await delay(150, 400, signal);
  guard();
  findQuiz(quizId);
  const done = loadAttempts().filter((a) => a.quizId === quizId && a.status !== 'in_progress');
  const percents = done.filter((a) => a.maxScore > 0 && a.score !== null).map((a) => (a.score / a.maxScore) * 100);
  return resultsSummaryFromApi({
    attempts: done.length,
    averagePercent: percents.length ? percents.reduce((x, y) => x + y, 0) / percents.length : null,
    highestPercent: percents.length ? Math.max(...percents) : null,
    lowestPercent: percents.length ? Math.min(...percents) : null,
    pendingGrading: done.filter((a) => a.status === 'pending_grading').length
  });
}

/**
 * GET /admin/attempts/{id}
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../../types.js').Attempt>}
 */
export async function getAttempt(id, { signal } = {}) {
  await delay(undefined, undefined, signal);
  guard();
  return attemptFromApi(toApiAttempt(findAttempt(id)));
}

/**
 * PATCH /admin/attempts/{id}/answers/{questionId}/grade — the server checks
 * the marks, stores them, and works out the new total and status.
 * Demo extra: feedback containing "simulate:server-error" fails.
 * @param {string} attemptId
 * @param {string} questionId
 * @param {{ marks: number, feedback: string }} grade
 * @returns {Promise<import('../../types.js').Attempt>}
 */
export async function gradeAnswer(attemptId, questionId, grade) {
  const body = gradeToApi(grade);
  await delay(250, 550);
  guard();
  if (String(body.feedback || '').toLowerCase().includes(DEMO_LIST_ERRORS.serverError)) throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  // Load once and change that copy: the store re-reads storage on every call.
  const all = loadAttempts();
  const attempt = all.find((a) => a.id === attemptId);
  if (!attempt) throw fail(404, 'ATTEMPT_NOT_FOUND', 'This attempt no longer exists.');
  const quiz = findQuiz(attempt.quizId);
  if (attempt.status === 'in_progress') throw fail(422, 'NOT_SUBMITTED', 'This attempt hasn’t been submitted yet, so it can’t be graded.');
  const question = quiz.questions.find((/** @type {any} */ q) => q.id === questionId);
  const answer = attempt.answers.find((/** @type {any} */ a) => a.questionId === questionId);
  if (!question || !answer) throw fail(404, 'ANSWER_NOT_FOUND', 'That answer isn’t part of this attempt.');
  if (!answer.needsManualGrading) throw fail(422, 'AUTO_GRADED', 'This answer was graded automatically.');
  const max = Number(question.marks) || 0;
  if (!Number.isFinite(body.marks) || body.marks < 0 || body.marks > max) {
    throw fail(422, 'VALIDATION_ERROR', 'Check the marks.', { marks: `Give between 0 and ${max} marks.` });
  }
  if (body.feedback && body.feedback.length > 1000) throw fail(422, 'VALIDATION_ERROR', 'Check the feedback.', { feedback: 'Feedback must be 1,000 characters or fewer.' });
  answer.manualMarks = body.marks;
  answer.feedback = body.feedback;
  recompute(attempt, quiz);
  markFinals(all.filter((a) => a.quizId === quiz.id), quiz);
  saveAttempts();
  return attemptFromApi(toApiAttempt(attempt));
}

// Dashboard (Stage 10) ---------------------------------------------------------------

const HOUR = 3600 * 1000;

/**
 * GET /admin/dashboard/summary, worked out from the demo data.
 * Demo extra: open dashboard.html?simulate=server-error (or =offline) to see
 * the Dashboard's error state.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../../types.js').DashboardSummary>}
 */
export async function getDashboardSummary({ signal } = {}) {
  await delay(undefined, undefined, signal);
  guard();
  const simulate = new URLSearchParams(window.location.search).get('simulate');
  if (simulate === 'server-error') throw fail(500, 'SERVER_ERROR', 'Simulated server error');
  if (simulate === 'offline') throw networkError();
  const now = Date.now();
  const quizzes = loadQuizzes();
  const active = quizzes.filter((q) => q.status !== 'archived');
  const pending = pendingCounts();
  const titleOf = (/** @type {string} */ id) => quizzes.find((q) => q.id === id)?.title || '';
  const soon = (/** @type {'closesAt' | 'opensAt'} */ key, /** @type {'open' | 'scheduled'} */ availability, /** @type {number} */ hours) => quizzes
    .filter((q) => availabilityOf(q, now) === availability && q.settings[key] && Date.parse(q.settings[key]) - now <= hours * HOUR && Date.parse(q.settings[key]) > now)
    .sort((a, b) => Date.parse(a.settings[key]) - Date.parse(b.settings[key]))
    .map((q) => ({ id: q.id, title: q.title, count: 0, at: q.settings[key] }));
  const submissions = loadAttempts()
    .filter((a) => a.submittedAt)
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
    .slice(0, 5)
    .map((a) => ({ attemptId: a.id, quizId: a.quizId, quizTitle: titleOf(a.quizId), participant: a.participant, submittedAt: a.submittedAt, status: a.status, score: a.score, maxScore: a.maxScore }));
  return dashboardFromApi({
    totals: {
      quizzes: active.length,
      published: quizzes.filter((q) => q.status === 'published').length,
      drafts: quizzes.filter((q) => q.status === 'draft').length,
      archived: quizzes.length - active.length,
      attempts: quizzes.reduce((sum, q) => sum + (Number(q.attemptCount) || 0), 0)
    },
    pendingGrading: {
      attempts: [...pending.values()].reduce((x, y) => x + y, 0),
      quizzes: [...pending.entries()].map(([id, count]) => ({ id, title: titleOf(id), count })).sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
    },
    closingSoon: soon('closesAt', 'open', 72),
    openingSoon: soon('opensAt', 'scheduled', 7 * 24),
    recentQuizzes: active.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 5).map(toApiSummary),
    recentSubmissions: submissions
  });
}
