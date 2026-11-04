// @ts-check
/**
 * One function per backend API call (the REAL backend).
 * js/api/mock/mock-api.js exports exactly the same functions for demo mode;
 * tests.html checks that the two lists match.
 * Endpoints follow the proposed contract (README "API contract", PENDING #1).
 * Auth, quizzes, questions, the Question Bank and results.
 */
import { request, upload } from './client.js';
import {
  adminFromApi, loginRequestToApi, quizFromApi, quizPageFromApi, quizListQueryToApi, quizCreateToApi, quizPatchToApi,
  questionCreateToApi, questionUpdateToApi, questionOrderToApi, uploadFromApi, duplicateFromApi,
  bankQuestionFromApi, bankPageFromApi, bankListQueryToApi, bankQuestionToApi, bankTagsFromApi,
  attemptFromApi, attemptPageFromApi, attemptListQueryToApi, resultsSummaryFromApi, gradeToApi, dashboardFromApi
} from './adapters.js';

/** @typedef {import('../types.js').Admin} Admin */
/** @typedef {import('../types.js').Quiz} Quiz */
/** @typedef {import('../types.js').QuizSummary} QuizSummary */
/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../types.js').BankQuestion} BankQuestion */

/**
 * POST /auth/login
 * @param {{ identifier: string, password: string }} credentials
 * @returns {Promise<Admin>}
 */
export async function login(credentials) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: loginRequestToApi(credentials),
    skipAuthEvent: true
  });
  return adminFromApi(data);
}

/**
 * POST /auth/logout
 * @returns {Promise<void>}
 */
export async function logout() {
  await request('/auth/logout', { method: 'POST', skipAuthEvent: true });
}

/**
 * GET /auth/me — the session check every protected page runs on load.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Admin>}
 */
export async function getMe({ signal } = {}) {
  const data = await request('/auth/me', { signal, skipAuthEvent: true });
  return adminFromApi(data);
}

// Quizzes (Stage 2) ----------------------------------------------------------------

/** @param {string} id */
const quizPath = (id) => `/admin/quizzes/${encodeURIComponent(id)}`;

/**
 * GET /admin/quizzes?q=&status=&availability=&sort=&page=&pageSize=
 * Filtering, sorting and paging happen on the server.
 * @param {{ q?: string, status?: string, availability?: string, sort?: string, page?: number, pageSize?: number, hasAttempts?: boolean }} [query]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../types.js').Page<QuizSummary>>}
 */
export async function listQuizzes(query = {}, { signal } = {}) {
  const data = await request('/admin/quizzes', { query: quizListQueryToApi(query), signal });
  return quizPageFromApi(data);
}

/**
 * GET /admin/quizzes/{id}
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Quiz>}
 */
export async function getQuiz(id, { signal } = {}) {
  return quizFromApi(await request(quizPath(id), { signal }));
}

/**
 * POST /admin/quizzes — creates a draft and returns it.
 * @param {{ title: string }} input
 * @returns {Promise<Quiz>}
 */
export async function createQuiz(input) {
  return quizFromApi(await request('/admin/quizzes', { method: 'POST', body: quizCreateToApi(input) }));
}

/**
 * POST /admin/quizzes/{id}/publish — the server re-runs every publish check.
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function publishQuiz(id) {
  return quizFromApi(await request(`${quizPath(id)}/publish`, { method: 'POST' }));
}

/**
 * POST /admin/quizzes/{id}/unpublish
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function unpublishQuiz(id) {
  return quizFromApi(await request(`${quizPath(id)}/unpublish`, { method: 'POST' }));
}

/**
 * POST /admin/quizzes/{id}/archive
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function archiveQuiz(id) {
  return quizFromApi(await request(`${quizPath(id)}/archive`, { method: 'POST' }));
}

/**
 * POST /admin/quizzes/{id}/restore
 * @param {string} id
 * @returns {Promise<Quiz>}
 */
export async function restoreQuiz(id) {
  return quizFromApi(await request(`${quizPath(id)}/restore`, { method: 'POST' }));
}

/**
 * DELETE /admin/quizzes/{id}
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteQuiz(id) {
  await request(quizPath(id), { method: 'DELETE' });
}

/**
 * POST /admin/quizzes/{id}/duplicate — returns the new draft and anything
 * that couldn't be copied (e.g. an image whose file is gone).
 * @param {string} id
 * @returns {Promise<{ quiz: Quiz, notCopied: { item: string, reason: string }[] }>}
 */
export async function duplicateQuiz(id) {
  return duplicateFromApi(await request(`${quizPath(id)}/duplicate`, { method: 'POST' }));
}

/**
 * PATCH /admin/quizzes/{id} — save changed details, settings or appearance. Sends the version being
 * edited; the server answers 409 if someone else saved in the meantime.
 * @param {string} id
 * @param {Parameters<typeof quizPatchToApi>[0]} changes
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function updateQuiz(id, changes, { version }) {
  return quizFromApi(await request(quizPath(id), { method: 'PATCH', body: quizPatchToApi(changes, version) }));
}

// Questions (Stage 4) ----------------------------------------------------------------
// Every question call sends the quiz version being edited (409 if it's out of
// date) and returns the whole updated quiz, with its new version.

/** @param {string} quizId @param {string} questionId */
const questionPath = (quizId, questionId) => `${quizPath(quizId)}/questions/${encodeURIComponent(questionId)}`;

/**
 * POST /admin/quizzes/{id}/questions — add a question at a position (1 = first).
 * @param {string} quizId
 * @param {Question} question   with its admin-created id
 * @param {{ version: number, position: number }} options
 * @returns {Promise<Quiz>}
 */
export async function createQuestion(quizId, question, { version, position }) {
  return quizFromApi(await request(`${quizPath(quizId)}/questions`, { method: 'POST', body: questionCreateToApi(question, { version, position }) }));
}

/**
 * PATCH /admin/quizzes/{id}/questions/{questionId} — send the whole question.
 * @param {string} quizId
 * @param {Question} question
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function updateQuestion(quizId, question, { version }) {
  return quizFromApi(await request(questionPath(quizId, question.id), { method: 'PATCH', body: questionUpdateToApi(question, version) }));
}

/**
 * DELETE /admin/quizzes/{id}/questions/{questionId}?version=
 * @param {string} quizId
 * @param {string} questionId
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function deleteQuestion(quizId, questionId, { version }) {
  return quizFromApi(await request(questionPath(quizId, questionId), { method: 'DELETE', query: { version } }));
}

/**
 * PUT /admin/quizzes/{id}/questions/order — every question id, in the new order.
 * @param {string} quizId
 * @param {string[]} questionIds
 * @param {{ version: number }} options
 * @returns {Promise<Quiz>}
 */
export async function reorderQuestions(quizId, questionIds, { version }) {
  return quizFromApi(await request(`${quizPath(quizId)}/questions/order`, { method: 'PUT', body: questionOrderToApi(questionIds, version) }));
}

/**
 * POST /admin/uploads/images (multipart, field "file") — returns the stored asset.
 * Only the asset id and URL are kept; never a local file path.
 * @param {File} file
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<{ assetId: string, url: string }>}
 */
export async function uploadImage(file, { onProgress, signal } = {}) {
  return uploadFromApi(await upload('/admin/uploads/images', file, { onProgress, signal }));
}

// Question Bank (Stage 8) ------------------------------------------------------------
// Editing a bank question makes a new version for FUTURE uses only; quizzes
// keep their own copy (with source = { bankQuestionId, bankVersion }).

/** @param {string} id */
const bankPath = (id) => `/admin/bank-questions/${encodeURIComponent(id)}`;

/**
 * GET /admin/bank-questions?q=&type=&tag=&usage=&status=&sort=&page=&pageSize=
 * @param {{ q?: string, type?: string, tag?: string, usage?: string, status?: string, sort?: string, page?: number, pageSize?: number }} [query]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../types.js').Page<BankQuestion>>}
 */
export async function listBankQuestions(query = {}, { signal } = {}) {
  return bankPageFromApi(await request('/admin/bank-questions', { query: bankListQueryToApi(query), signal }));
}

/**
 * GET /admin/bank-questions/{id}
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<BankQuestion>}
 */
export async function getBankQuestion(id, { signal } = {}) {
  return bankQuestionFromApi(await request(bankPath(id), { signal }));
}

/**
 * POST /admin/bank-questions — version 1 of a new bank question.
 * @param {Omit<Question, 'order' | 'source'>} question   with its admin-created id
 * @param {{ tags: string[] }} options
 * @returns {Promise<BankQuestion>}
 */
export async function createBankQuestion(question, { tags }) {
  return bankQuestionFromApi(await request('/admin/bank-questions', { method: 'POST', body: bankQuestionToApi(question, tags) }));
}

/**
 * PATCH /admin/bank-questions/{id} — a content change makes a new version.
 * Sends the version being edited (409 if someone else saved first).
 * @param {string} id
 * @param {Omit<Question, 'order' | 'source'>} question
 * @param {{ tags: string[], version: number }} options
 * @returns {Promise<BankQuestion>}
 */
export async function updateBankQuestion(id, question, { tags, version }) {
  return bankQuestionFromApi(await request(bankPath(id), { method: 'PATCH', body: { ...bankQuestionToApi(question, tags), version } }));
}

/**
 * DELETE /admin/bank-questions/{id} — only if no quiz has ever used it.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteBankQuestion(id) {
  await request(bankPath(id), { method: 'DELETE' });
}

/** POST /admin/bank-questions/{id}/archive @param {string} id @returns {Promise<BankQuestion>} */
export async function archiveBankQuestion(id) {
  return bankQuestionFromApi(await request(`${bankPath(id)}/archive`, { method: 'POST' }));
}

/** POST /admin/bank-questions/{id}/restore @param {string} id @returns {Promise<BankQuestion>} */
export async function restoreBankQuestion(id) {
  return bankQuestionFromApi(await request(`${bankPath(id)}/restore`, { method: 'POST' }));
}

/**
 * GET /admin/bank-questions/tags — every tag in use, for suggestions and filters.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<string[]>}
 */
export async function listBankTags({ signal } = {}) {
  return bankTagsFromApi(await request('/admin/bank-questions/tags', { signal }));
}

// Results (Stage 9) ------------------------------------------------------------------
// Scores, totals and statuses always come from the backend; the admin site
// only shows them (and sends a grader's marks).

/**
 * GET /admin/quizzes/{id}/attempts?q=&status=&from=&to=&sort=&page=&pageSize=
 * @param {string} quizId
 * @param {{ q?: string, status?: string, from?: string, to?: string, sort?: string, page?: number, pageSize?: number }} [query]
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../types.js').Page<import('../types.js').AttemptSummary>>}
 */
export async function listAttempts(quizId, query = {}, { signal } = {}) {
  return attemptPageFromApi(await request(`${quizPath(quizId)}/attempts`, { query: attemptListQueryToApi(query), signal }));
}

/**
 * GET /admin/quizzes/{id}/results/summary
 * @param {string} quizId
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../types.js').ResultsSummary>}
 */
export async function getResultsSummary(quizId, { signal } = {}) {
  return resultsSummaryFromApi(await request(`${quizPath(quizId)}/results/summary`, { signal }));
}

/**
 * GET /admin/attempts/{id}
 * @param {string} id
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../types.js').Attempt>}
 */
export async function getAttempt(id, { signal } = {}) {
  return attemptFromApi(await request(`/admin/attempts/${encodeURIComponent(id)}`, { signal }));
}

/**
 * PATCH /admin/attempts/{id}/answers/{questionId}/grade — returns the updated
 * attempt, with the new total worked out by the backend.
 * @param {string} attemptId
 * @param {string} questionId
 * @param {{ marks: number, feedback: string }} grade
 * @returns {Promise<import('../types.js').Attempt>}
 */
export async function gradeAnswer(attemptId, questionId, grade) {
  return attemptFromApi(await request(`/admin/attempts/${encodeURIComponent(attemptId)}/answers/${encodeURIComponent(questionId)}/grade`, { method: 'PATCH', body: gradeToApi(grade) }));
}

// Dashboard (Stage 10) ---------------------------------------------------------------

/**
 * GET /admin/dashboard/summary — the totals, what needs attention, and the
 * recent quizzes and submissions, in one request.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<import('../types.js').DashboardSummary>}
 */
export async function getDashboardSummary({ signal } = {}) {
  return dashboardFromApi(await request('/admin/dashboard/summary', { signal }));
}
