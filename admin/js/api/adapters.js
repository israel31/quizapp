// @ts-check
/**
 * The ONE place where backend field names are mapped to the admin site's
 * model (js/types.js) and back. If the backend's final contract renames a
 * field, change it here — not across the site.
 * Auth (Stage 1), quizzes (Stage 2), quiz details (Stage 3) and questions and
 * uploads (Stage 4) so far; bank and attempt mappers are added in the stages
 * that first use them.
 */
import { CONFIG } from '../config.js';
import { DEFAULT_APPEARANCE as APPEARANCE_DEFAULTS, sanitizeAppearance, sanitizeOverrides } from '../quiz/appearance.js';

/** @typedef {import('../types.js').Admin} Admin */
/** @typedef {import('../types.js').Quiz} Quiz */
/** @typedef {import('../types.js').QuizSummary} QuizSummary */
/** @typedef {import('../types.js').QuizSettings} QuizSettings */
/** @typedef {import('../types.js').Appearance} Appearance */
/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../types.js').Option} Option */
/** @typedef {import('../types.js').QuizImage} QuizImage */
/** @typedef {import('../types.js').BankQuestion} BankQuestion */
/** @typedef {import('../types.js').Attempt} Attempt */
/** @typedef {import('../types.js').AttemptSummary} AttemptSummary */
/** @typedef {import('../types.js').Answer} Answer */

/**
 * Admin account from /auth/me or /auth/login.
 * Accepts { admin: {...} }, { user: {...} } or the object itself, and either
 * camelCase or snake_case names (PENDING #1: the exact response shape).
 * @param {any} raw
 * @returns {Admin}
 */
export function adminFromApi(raw) {
  const source = raw && typeof raw === 'object' ? (raw.admin || raw.user || raw) : {};
  const email = String(source.email ?? '');
  const joined = [source.firstName ?? source.first_name, source.lastName ?? source.last_name].filter(Boolean).join(' ');
  const name = String(source.name ?? source.fullName ?? source.full_name ?? (joined || '')).trim();
  return {
    id: String(source.id ?? ''),
    name: name || email.split('@')[0] || 'Administrator',
    email,
    role: String(source.role ?? 'admin')
  };
}

/**
 * Login request body. PENDING #1: email (default) or username.
 * @param {{ identifier: string, password: string }} credentials
 */
export function loginRequestToApi({ identifier, password }) {
  const key = CONFIG.AUTH.identifier === 'username' ? 'username' : 'email';
  return { [key]: identifier.trim(), password };
}

/**
 * Map server field-error names to the login form's field names.
 * @param {Record<string, string>} fieldErrors
 * @returns {Record<string, string>}
 */
export function loginFieldErrorsFromApi(fieldErrors) {
  /** @type {Record<string, string>} */
  const mapped = {};
  for (const [key, message] of Object.entries(fieldErrors || {})) {
    if (key === 'email' || key === 'username') mapped.identifier = message;
    else if (key === 'password') mapped.password = message;
  }
  return mapped;
}

/**
 * Initials for the account avatar, e.g. "Demo Admin" -> "DA".
 * @param {string} name
 */
export function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Quizzes (Stage 2) --------------------------------------------------------------

const QUIZ_STATUSES = ['draft', 'published', 'archived'];
const AVAILABILITIES = ['scheduled', 'open', 'closed'];

/** Defaults for settings the backend leaves out (section 32 defaults). */
export const DEFAULT_SETTINGS = Object.freeze({
  durationMinutes: null,
  opensAt: null,
  closesAt: null,
  maxAttempts: 1,
  attemptScoring: 'highest',
  checkboxScoring: 'all_or_nothing',
  resultVisibility: 'after_close',
  showCorrectAnswers: false,
  shortAnswerCaseSensitive: false
});

/** The quiz-wide appearance a new quiz starts with: JCI Classic (section 17). */
export const DEFAULT_APPEARANCE = APPEARANCE_DEFAULTS;

/** @param {any} value */
const str = (value) => (value === null || value === undefined ? '' : String(value));
/** @param {any} value */
const isoOrNull = (value) => (value ? String(value) : null);
/** @param {any} value @param {number} fallback */
const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
/** @param {any} value */
const numOrNull = (value) => (value === null || value === undefined || value === '' ? null : num(value, 0));

/**
 * @param {any} raw
 * @returns {QuizSettings}
 */
export function settingsFromApi(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    durationMinutes: numOrNull(s.durationMinutes ?? s.duration_minutes),
    opensAt: isoOrNull(s.opensAt ?? s.opens_at),
    closesAt: isoOrNull(s.closesAt ?? s.closes_at),
    maxAttempts: 'maxAttempts' in s || 'max_attempts' in s ? numOrNull(s.maxAttempts ?? s.max_attempts) : DEFAULT_SETTINGS.maxAttempts,
    attemptScoring: (s.attemptScoring ?? s.attempt_scoring) === 'latest' ? 'latest' : 'highest',
    checkboxScoring: (s.checkboxScoring ?? s.checkbox_scoring) === 'partial' ? 'partial' : 'all_or_nothing',
    resultVisibility: ['immediately', 'after_close', 'manual'].includes(s.resultVisibility ?? s.result_visibility)
      ? (s.resultVisibility ?? s.result_visibility)
      : DEFAULT_SETTINGS.resultVisibility,
    showCorrectAnswers: Boolean(s.showCorrectAnswers ?? s.show_correct_answers),
    shortAnswerCaseSensitive: Boolean(s.shortAnswerCaseSensitive ?? s.short_answer_case_sensitive)
  };
}

/**
 * @param {any} raw
 * @returns {Appearance}
 */
export function appearanceFromApi(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return sanitizeAppearance({
    fontFamily: a.fontFamily ?? a.font_family,
    fontSize: a.fontSize ?? a.font_size,
    textColor: a.textColor ?? a.text_color,
    pageBackground: a.pageBackground ?? a.page_background,
    cardBackground: a.cardBackground ?? a.card_background,
    bold: a.bold,
    italic: a.italic,
    underline: a.underline,
    align: a.align
  });
}

/**
 * @param {any} raw
 * @returns {QuizImage | null}
 */
function imageFromApi(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    assetId: str(raw.assetId ?? raw.asset_id),
    url: str(raw.url),
    alt: str(raw.alt),
    decorative: Boolean(raw.decorative),
    placement: raw.placement,
    size: raw.size
  };
}

/**
 * @param {any} raw
 * @returns {Question}
 */
export function questionFromApi(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  /** @type {Question} */
  const question = {
    id: str(q.id),
    type: q.type,
    order: num(q.order, 0),
    text: str(q.text),
    explanation: q.explanation ? String(q.explanation) : null,
    marks: num(q.marks, 0),
    image: imageFromApi(q.image),
    appearance: sanitizeOverrides(q.appearance),
    source: q.source && typeof q.source === 'object'
      ? { bankQuestionId: str(q.source.bankQuestionId ?? q.source.bank_question_id), bankVersion: num(q.source.bankVersion ?? q.source.bank_version, 1) }
      : null
  };
  if (Array.isArray(q.options)) {
    question.options = q.options.map((/** @type {any} */ o) => /** @type {Option} */ ({
      id: str(o.id),
      text: str(o.text),
      image: imageFromApi(o.image),
      isCorrect: Boolean(o.isCorrect ?? o.is_correct)
    }));
  }
  if (q.type === 'short_answer') {
    question.acceptedAnswers = Array.isArray(q.acceptedAnswers ?? q.accepted_answers) ? (q.acceptedAnswers ?? q.accepted_answers).map(String) : [];
    question.caseSensitive = Boolean(q.caseSensitive ?? q.case_sensitive);
  }
  if (q.type === 'short_answer' || q.type === 'paragraph') question.maxLength = numOrNull(q.maxLength ?? q.max_length);
  if (q.type === 'paragraph') question.gradingNotes = str(q.gradingNotes ?? q.grading_notes);
  return question;
}

/**
 * A quiz as it appears in lists (no questions needed).
 * @param {any} raw
 * @returns {QuizSummary}
 */
export function quizSummaryFromApi(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const status = QUIZ_STATUSES.includes(q.status) ? q.status : 'draft';
  const availability = AVAILABILITIES.includes(q.availability) ? q.availability : null;
  const questions = Array.isArray(q.questions) ? q.questions : null;
  return {
    id: str(q.id),
    title: str(q.title),
    description: str(q.description),
    status,
    // Availability only means something for published quizzes (section 12).
    availability: status === 'published' ? availability : null,
    settings: settingsFromApi(q.settings),
    questionCount: num(q.questionCount ?? q.question_count ?? questions?.length, 0),
    totalMarks: num(q.totalMarks ?? q.total_marks, 0),
    attemptCount: num(q.attemptCount ?? q.attempt_count, 0),
    pendingGradingCount: num(q.pendingGradingCount ?? q.pending_grading_count, 0),
    version: num(q.version, 1),
    createdAt: str(q.createdAt ?? q.created_at),
    updatedAt: str(q.updatedAt ?? q.updated_at),
    publishedAt: isoOrNull(q.publishedAt ?? q.published_at)
  };
}

/**
 * A full quiz with its questions and appearance (GET /admin/quizzes/{id}).
 * @param {any} raw
 * @returns {Quiz}
 */
export function quizFromApi(raw) {
  const source = raw && typeof raw === 'object' ? (raw.quiz || raw) : {};
  const summary = quizSummaryFromApi(source);
  const questions = (Array.isArray(source.questions) ? source.questions : [])
    .map(questionFromApi)
    .sort((/** @type {Question} */ a, /** @type {Question} */ b) => a.order - b.order);
  return {
    ...summary,
    instructions: str(source.instructions),
    appearance: appearanceFromApi(source.appearance),
    questions,
    questionCount: questions.length || summary.questionCount
  };
}

/**
 * POST /admin/quizzes/{id}/duplicate: the new draft, plus anything the
 * server couldn't copy, so the admin is told instead of it being dropped
 * silently (section 23). Accepts { quiz, notCopied } or the quiz itself.
 * @param {any} raw
 * @returns {{ quiz: Quiz, notCopied: { item: string, reason: string }[] }}
 */
export function duplicateFromApi(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(data.notCopied ?? data.not_copied) ? (data.notCopied ?? data.not_copied) : [];
  return {
    quiz: quizFromApi(data.quiz || data),
    notCopied: list.map((/** @type {any} */ entry) => ({ item: str(entry?.item), reason: str(entry?.reason) })).filter((e) => e.item)
  };
}

/**
 * A page of quizzes: { items, page, pageSize, total }.
 * @param {any} raw
 * @returns {import('../types.js').Page<QuizSummary>}
 */
export function quizPageFromApi(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    items: items.map(quizSummaryFromApi),
    page: num(data.page, 1),
    pageSize: num(data.pageSize ?? data.page_size, items.length),
    total: num(data.total, items.length)
  };
}

/**
 * List query parameters. PENDING: parameter names to confirm with the backend.
 * No status means "draft and published" (archived quizzes are hidden from active lists).
 * `status: 'any'` includes archived quizzes; `hasAttempts` keeps only quizzes
 * that participants have taken (the Results overview).
 * @param {{ q?: string, status?: string, availability?: string, sort?: string, page?: number, pageSize?: number, hasAttempts?: boolean }} query
 */
export function quizListQueryToApi({ q = '', status = '', availability = '', sort = '', page = 1, pageSize = CONFIG.PAGE_SIZE_DEFAULT, hasAttempts = false }) {
  return {
    q: q.trim() || undefined,
    status: status || undefined,
    availability: availability || undefined,
    sort: sort || undefined,
    hasAttempts: hasAttempts ? 'true' : undefined,
    page,
    pageSize
  };
}

/**
 * Body for POST /admin/quizzes.
 * @param {{ title: string }} input
 */
export function quizCreateToApi({ title }) {
  return { title: title.trim() };
}

/** Quiz fields the Details tab edits (Stage 3). */
export const QUIZ_DETAIL_FIELDS = Object.freeze(['title', 'description', 'instructions']);

/**
 * Settings as the API expects them: times in ISO 8601 UTC, whole numbers.
 * @param {QuizSettings} s
 */
export function settingsToApi(s) {
  return {
    durationMinutes: s.durationMinutes === null ? null : Math.round(Number(s.durationMinutes)),
    opensAt: s.opensAt ? new Date(s.opensAt).toISOString() : null,
    closesAt: s.closesAt ? new Date(s.closesAt).toISOString() : null,
    maxAttempts: s.maxAttempts === null ? null : Math.round(Number(s.maxAttempts)),
    attemptScoring: s.attemptScoring,
    checkboxScoring: s.checkboxScoring,
    resultVisibility: s.resultVisibility,
    showCorrectAnswers: Boolean(s.showCorrectAnswers),
    shortAnswerCaseSensitive: Boolean(s.shortAnswerCaseSensitive)
  };
}

/** The complete quiz appearance, validated. @param {Partial<Appearance>} a */
export function appearanceToApi(a) {
  return { ...sanitizeAppearance(a) };
}

/**
 * Body for PATCH /admin/quizzes/{id}: only the changed parts, plus the
 * version the admin was editing (a mismatch returns 409, so nothing is
 * silently overwritten). Settings and appearance are sent whole.
 * @param {{ title?: string, description?: string, instructions?: string, settings?: QuizSettings, appearance?: Partial<Appearance> }} changes
 * @param {number} version
 */
export function quizPatchToApi(changes, version) {
  /** @type {Record<string, unknown>} */
  const body = { version };
  for (const key of QUIZ_DETAIL_FIELDS) {
    const value = changes[/** @type {'title'} */ (key)];
    if (typeof value === 'string') body[key] = key === 'instructions' ? value.replace(/\r\n/g, '\n').trim() : value.trim();
  }
  if (changes.settings) body.settings = settingsToApi(changes.settings);
  if (changes.appearance) body.appearance = appearanceToApi(changes.appearance);
  return body;
}

// Questions and uploads (Stage 4) ------------------------------------------------

const cleanText = (/** @type {unknown} */ value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

/**
 * An image as the backend stores it: the asset id from the upload endpoint
 * plus its description. The URL comes back from the server, so it isn't sent.
 * @param {QuizImage | null | undefined} image
 */
export function imageToApi(image) {
  if (!image) return null;
  /** @type {Record<string, unknown>} */
  const body = { assetId: image.assetId, alt: image.decorative ? '' : cleanText(image.alt), decorative: Boolean(image.decorative) };
  if (image.placement) body.placement = image.placement;
  if (image.size) body.size = image.size;
  return body;
}

/**
 * A question for POST/PUT. Only the fields its type uses are sent; ids are
 * created by the admin site (UUIDs) so a retried request can't make a copy.
 * @param {Question} q
 */
export function questionToApi(q) {
  /** @type {Record<string, unknown>} */
  const body = {
    id: q.id,
    type: q.type,
    text: cleanText(q.text),
    explanation: q.explanation && cleanText(q.explanation) ? cleanText(q.explanation) : null,
    marks: Number(q.marks),
    image: imageToApi(q.image),
    appearance: { ...(q.appearance || {}) },
    source: q.source ? { bankQuestionId: q.source.bankQuestionId, bankVersion: q.source.bankVersion } : null
  };
  if (q.type === 'multiple_choice' || q.type === 'checkboxes') {
    body.options = (q.options || []).map((o) => ({ id: o.id, text: cleanText(o.text), image: imageToApi(o.image), isCorrect: Boolean(o.isCorrect) }));
  }
  if (q.type === 'short_answer') {
    body.acceptedAnswers = (q.acceptedAnswers || []).map((a) => cleanText(a).replace(/\s+/g, ' ')).filter(Boolean);
    body.caseSensitive = Boolean(q.caseSensitive);
  }
  if (q.type === 'paragraph') body.gradingNotes = cleanText(q.gradingNotes);
  if (q.type === 'short_answer' || q.type === 'paragraph') body.maxLength = q.maxLength ?? null;
  return body;
}

/** POST /admin/quizzes/{id}/questions @param {Question} q @param {{ version: number, position: number }} at */
export function questionCreateToApi(q, { version, position }) {
  return { version, position, question: questionToApi(q) };
}

/** PUT /admin/quizzes/{id}/questions/{questionId} @param {Question} q @param {number} version */
export function questionUpdateToApi(q, version) {
  return { version, question: questionToApi(q) };
}

/** PUT /admin/quizzes/{id}/question-order @param {string[]} ids @param {number} version */
export function questionOrderToApi(ids, version) {
  return { version, questionIds: ids.slice() };
}

/**
 * POST /admin/uploads response: { assetId, url } (or { asset: {...} }).
 * @param {any} raw
 * @returns {{ assetId: string, url: string }}
 */
export function uploadFromApi(raw) {
  const source = raw && typeof raw === 'object' ? (raw.asset || raw) : {};
  return { assetId: str(source.assetId ?? source.asset_id ?? source.id), url: str(source.url) };
}

// Question Bank (Stage 8) --------------------------------------------------------

export const BANK_TAG_LIMITS = Object.freeze({ count: 10, length: 30 });

/**
 * Tags as typed: trimmed, single spaces, up to 30 characters, no repeats
 * (ignoring capitals), at most 10.
 * @param {string[]} tags
 */
export function cleanTags(tags) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const raw of tags || []) {
    const tag = String(raw).replace(/\s+/g, ' ').trim().slice(0, BANK_TAG_LIMITS.length);
    const key = tag.toLocaleLowerCase('en');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === BANK_TAG_LIMITS.count) break;
  }
  return out;
}

/**
 * A bank question: the same fields as a quiz question (minus order and
 * source), plus tags, status, version and how many quizzes use it.
 * @param {any} raw
 * @returns {BankQuestion}
 */
export function bankQuestionFromApi(raw) {
  const q = raw && typeof raw === 'object' ? (raw.question || raw) : {};
  const { order, source, ...rest } = questionFromApi(q);
  return {
    ...rest,
    tags: cleanTags(Array.isArray(q.tags) ? q.tags : []),
    status: q.status === 'archived' ? 'archived' : 'active',
    version: num(q.version, 1),
    usedInQuizCount: num(q.usedInQuizCount ?? q.used_in_quiz_count, 0),
    createdAt: str(q.createdAt ?? q.created_at),
    updatedAt: str(q.updatedAt ?? q.updated_at)
  };
}

/** @param {any} raw @returns {import('../types.js').Page<BankQuestion>} */
export function bankPageFromApi(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    items: items.map(bankQuestionFromApi),
    page: num(data.page, 1),
    pageSize: num(data.pageSize ?? data.page_size, items.length),
    total: num(data.total, items.length)
  };
}

/**
 * List query. No status means active questions only.
 * @param {{ q?: string, type?: string, tag?: string, usage?: string, status?: string, sort?: string, page?: number, pageSize?: number }} query
 */
export function bankListQueryToApi({ q = '', type = '', tag = '', usage = '', status = '', sort = '', page = 1, pageSize = CONFIG.PAGE_SIZE_DEFAULT }) {
  return {
    q: q.trim() || undefined,
    type: type || undefined,
    tag: tag || undefined,
    usage: usage || undefined,
    status: status || undefined,
    sort: sort || undefined,
    page,
    pageSize
  };
}

/**
 * Body for POST/PATCH /admin/bank-questions: the question (like a quiz
 * question, but never linked to a source) and its tags.
 * @param {Omit<Question, 'order' | 'source'> & { source?: unknown }} question
 * @param {string[]} tags
 * @returns {Record<string, any>}
 */
export function bankQuestionToApi(question, tags) {
  const { source, ...body } = questionToApi(/** @type {Question} */ ({ ...question, order: 0, source: null }));
  return { ...body, tags: cleanTags(tags) };
}

/** GET /admin/bank-questions/tags: ["Leadership", …] or { items: [...] }. @param {any} raw */
export function bankTagsFromApi(raw) {
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.items) ? raw.items : [];
  return cleanTags(list.map(String)).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

// Results (Stage 9) -------------------------------------------------------------------

const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'pending_grading', 'graded'];
/** @param {any} value */
const markOrNull = (value) => (value === null || value === undefined || value === '' ? null : Math.round(num(value, 0) * 100) / 100);

/**
 * The person who took a quiz: name and email (decision 11).
 * @param {any} raw
 * @returns {import('../types.js').Participant}
 */
export function participantFromApi(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const email = str(p.email);
  return { id: str(p.id), name: str(p.name ?? p.fullName ?? p.full_name).trim() || email || 'Unnamed participant', email };
}

/** @param {any} raw @returns {Answer} */
export function answerFromApi(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const selected = a.selectedOptionIds ?? a.selected_option_ids;
  return {
    questionId: str(a.questionId ?? a.question_id),
    selectedOptionIds: Array.isArray(selected) ? selected.map(String) : [],
    text: a.text === null || a.text === undefined ? null : String(a.text),
    autoMarks: markOrNull(a.autoMarks ?? a.auto_marks),
    manualMarks: markOrNull(a.manualMarks ?? a.manual_marks),
    feedback: a.feedback ? String(a.feedback) : null,
    needsManualGrading: Boolean(a.needsManualGrading ?? a.needs_manual_grading)
  };
}

/** A row in Results. @param {any} raw @returns {AttemptSummary} */
export function attemptSummaryFromApi(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  return {
    id: str(a.id),
    quizId: str(a.quizId ?? a.quiz_id),
    participant: participantFromApi(a.participant ?? a.student ?? a.user),
    attemptNumber: num(a.attemptNumber ?? a.attempt_number, 1),
    status: ATTEMPT_STATUSES.includes(a.status) ? a.status : 'submitted',
    startedAt: str(a.startedAt ?? a.started_at),
    submittedAt: isoOrNull(a.submittedAt ?? a.submitted_at),
    score: markOrNull(a.score),
    maxScore: num(a.maxScore ?? a.max_score, 0),
    isFinal: Boolean(a.isFinal ?? a.is_final)
  };
}

/** One attempt in full, with answers, the questions as seen, and navigation. @param {any} raw @returns {Attempt} */
export function attemptFromApi(raw) {
  const a = raw && typeof raw === 'object' ? (raw.attempt || raw) : {};
  const quiz = a.quiz && typeof a.quiz === 'object' ? a.quiz : {};
  const nav = a.navigation && typeof a.navigation === 'object' ? a.navigation : {};
  return {
    ...attemptSummaryFromApi(a),
    quiz: { id: str(quiz.id ?? a.quizId ?? a.quiz_id), title: str(quiz.title), status: QUIZ_STATUSES.includes(quiz.status) ? quiz.status : 'published' },
    answers: (Array.isArray(a.answers) ? a.answers : []).map(answerFromApi),
    questions: (Array.isArray(a.questions) ? a.questions : []).map(questionFromApi).sort((x, y) => x.order - y.order),
    navigation: {
      previousId: str(nav.previousId ?? nav.previous_id) || null,
      nextId: str(nav.nextId ?? nav.next_id) || null,
      nextToGradeId: str(nav.nextToGradeId ?? nav.next_to_grade_id) || null
    }
  };
}

/** @param {any} raw @returns {import('../types.js').Page<AttemptSummary>} */
export function attemptPageFromApi(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return { items: items.map(attemptSummaryFromApi), page: num(data.page, 1), pageSize: num(data.pageSize ?? data.page_size, items.length), total: num(data.total, items.length) };
}

/**
 * Attempts query. Dates are whole days in the admin's time zone, sent as UTC.
 * @param {{ q?: string, status?: string, from?: string, to?: string, sort?: string, page?: number, pageSize?: number }} query
 */
export function attemptListQueryToApi({ q = '', status = '', from = '', to = '', sort = '', page = 1, pageSize = CONFIG.PAGE_SIZE_DEFAULT }) {
  const day = (/** @type {string} */ value, /** @type {string} */ time) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T${time}`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };
  return {
    q: q.trim() || undefined,
    status: status || undefined,
    from: from ? day(from, '00:00:00') : undefined,
    to: to ? day(to, '23:59:59.999') : undefined,
    sort: sort || undefined,
    page,
    pageSize
  };
}

/** @param {any} raw @returns {import('../types.js').ResultsSummary} */
export function resultsSummaryFromApi(raw) {
  const s = raw && typeof raw === 'object' ? (raw.summary || raw) : {};
  /** @param {any} v */
  const pct = (v) => (v === null || v === undefined || v === '' ? null : Math.round(num(v, 0) * 10) / 10);
  return {
    attempts: num(s.attempts ?? s.attemptCount ?? s.attempt_count, 0),
    averagePercent: pct(s.averagePercent ?? s.average_percent),
    highestPercent: pct(s.highestPercent ?? s.highest_percent),
    lowestPercent: pct(s.lowestPercent ?? s.lowest_percent),
    pendingGrading: num(s.pendingGrading ?? s.pending_grading, 0)
  };
}

/**
 * Body for PATCH /admin/attempts/{id}/answers/{questionId}/grade.
 * @param {{ marks: number, feedback: string }} grade
 */
export function gradeToApi({ marks, feedback }) {
  const clean = String(feedback ?? '').replace(/\r\n/g, '\n').trim();
  return { marks: Math.round(Number(marks) * 100) / 100, feedback: clean || null };
}

/* Dashboard (Stage 10) ---------------------------------------------------------------- */

/** @param {any} raw @returns {import('../types.js').AttentionQuiz} */
function attentionQuizFromApi(raw) {
  const q = raw && typeof raw === 'object' ? raw : {};
  return {
    id: str(q.id ?? q.quizId ?? q.quiz_id),
    title: str(q.title),
    count: num(q.count ?? q.pendingGrading ?? q.pending_grading ?? q.pendingGradingCount ?? q.pending_grading_count, 0),
    at: isoOrNull(q.at ?? q.closesAt ?? q.closes_at ?? q.opensAt ?? q.opens_at)
  };
}

/** @param {any} list @returns {import('../types.js').AttentionQuiz[] | null} */
const attentionListFromApi = (list) => (Array.isArray(list) ? list.map(attentionQuizFromApi).filter((q) => q.id) : null);

/** @param {any} raw @returns {import('../types.js').RecentSubmission} */
function recentSubmissionFromApi(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const quiz = a.quiz && typeof a.quiz === 'object' ? a.quiz : {};
  return {
    attemptId: str(a.attemptId ?? a.attempt_id ?? a.id),
    quizId: str(a.quizId ?? a.quiz_id ?? quiz.id),
    quizTitle: str(a.quizTitle ?? a.quiz_title ?? quiz.title),
    participant: participantFromApi(a.participant ?? a.student ?? a.user),
    submittedAt: str(a.submittedAt ?? a.submitted_at),
    status: ATTEMPT_STATUSES.includes(a.status) ? a.status : 'submitted',
    score: markOrNull(a.score),
    maxScore: num(a.maxScore ?? a.max_score, 0)
  };
}

/**
 * GET /admin/dashboard/summary. Missing lists stay null ("not available"),
 * never invented.
 * @param {any} raw
 * @returns {import('../types.js').DashboardSummary}
 */
export function dashboardFromApi(raw) {
  const d = raw && typeof raw === 'object' ? (raw.summary || raw) : {};
  const t = d.totals && typeof d.totals === 'object' ? d.totals : d;
  const pending = d.pendingGrading ?? d.pending_grading;
  const recentQuizzes = d.recentQuizzes ?? d.recent_quizzes;
  const recentSubmissions = d.recentSubmissions ?? d.recent_submissions;
  return {
    totals: {
      quizzes: num(t.quizzes ?? t.quizCount ?? t.quiz_count, 0),
      published: num(t.published, 0),
      drafts: num(t.drafts, 0),
      archived: num(t.archived, 0),
      attempts: num(t.attempts ?? t.attemptCount ?? t.attempt_count, 0)
    },
    pendingGrading: pending && typeof pending === 'object'
      ? { attempts: num(pending.attempts ?? pending.count, 0), quizzes: attentionListFromApi(pending.quizzes) || [] }
      : null,
    closingSoon: attentionListFromApi(d.closingSoon ?? d.closing_soon),
    openingSoon: attentionListFromApi(d.openingSoon ?? d.opening_soon),
    recentQuizzes: Array.isArray(recentQuizzes) ? recentQuizzes.map(quizSummaryFromApi) : [],
    recentSubmissions: Array.isArray(recentSubmissions) ? recentSubmissions.map(recentSubmissionFromApi).filter((s) => s.attemptId) : null
  };
}
