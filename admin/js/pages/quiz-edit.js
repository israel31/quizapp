// @ts-check
/**
 * The quiz editor (quiz-edit.html).
 * - Header: title, status badges, save status, Preview and the main action.
 * - Tabs (Details, Questions, Settings, Review & Publish), kept in the URL hash
 *   so refreshing and the back button work; arrow keys move between them.
 * - Details: title, description and instructions, saved automatically.
 * - Questions: the question builder (Stage 4), saved automatically through the
 *   same autosave, one change at a time, in a safe order.
 * - Details also holds the quiz appearance (Stage 5): presets, fonts, colours
 *   and a live sample, saved with the quiz.
 * - Settings (Stage 6): timing, availability, attempts, grading and results,
 *   with the locking rules once participants have started.
 * - Review & Publish runs the publish checks; Fix goes straight to the field
 *   that needs it, and Publish confirms the key facts first.
 * Work is never lost: an expired session opens a sign-in dialog instead of
 * redirecting, and a conflict stops autosave instead of overwriting.
 */
import { api } from '../api/index.js';
import { ApiError, userMessage } from '../api/client.js';
import { QUIZ_DETAIL_FIELDS } from '../api/adapters.js';
import { el, qs, qsa } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { createStore } from '../core/store.js';
import { createAutosave, diffFields } from '../core/autosave.js';
import { formatDateTime, formatNumber, formatRelative, plural } from '../core/format.js';
import { redirectToLogin } from '../core/session.js';
import { setFlash, takeFlash } from '../core/flash.js';
import { prefersReducedMotion } from '../core/motion.js';
import { bootPage } from '../components/shell.js';
import { toast } from '../components/toast.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { showMenu, menuButtonAttrs } from '../components/menu.js';
import { statusBadge, availabilityBadge } from '../components/badge.js';
import { emptyState, errorState } from '../components/states.js';
import { setFieldError, clearFieldError, showErrorSummary, hideFormMessage } from '../components/form-feedback.js';
import { createSaveStatus } from '../components/save-status.js';
import { signInAgain } from '../components/sign-in-dialog.js';
import { setButtonLoading } from '../components/button.js';
import {
  DETAIL_LIMITS, QUESTION_TYPE_LABELS, SETTING_LABELS,
  availabilityInfo, isLocked, validateQuizDetails
} from '../quiz/quiz-rules.js';
import { publishIssues } from '../quiz/publish-checks.js';
import { createQuestionBuilder } from '../quiz/question-builder.js';
import { questionOps, totalMarks, questionFromBank } from '../quiz/question-model.js';
import { pickFromBank, saveToBank, reviewUpdate } from '../quiz/bank-dialogs.js';
import { questionsToText } from '../quiz/question-types.js';
import { createQuizAppearancePanel } from '../quiz/appearance-panel.js';
import { createSettingsPanel } from '../quiz/settings-panel.js';
import { matchPreset } from '../quiz/appearance.js';
import {
  publishQuiz, unpublishQuiz, archiveQuiz, restoreQuiz, deleteQuiz, duplicateQuiz, publishFacts, quizName
} from '../quiz/quiz-actions.js';

/** @typedef {import('../types.js').Quiz} Quiz */
/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../quiz/question-model.js').QuestionOp} QuestionOp */
/** @typedef {{ kind: 'details', changes: Record<string, string> } | { kind: 'question', op: QuestionOp }} PendingChange */
/** @typedef {import('../types.js').Admin} Admin */
/** @typedef {import('../core/autosave.js').SaveState} SaveState */
/** @typedef {import('../quiz/publish-checks.js').PublishIssue} PublishIssue */
/** @typedef {'details' | 'questions' | 'settings' | 'review'} TabId */

const TABS = /** @type {const} */ (['details', 'questions', 'settings', 'review']);
const quizId = new URLSearchParams(window.location.search).get('id') || '';

// Elements ---------------------------------------------------------------------------
const titleEl = /** @type {HTMLElement} */ (qs('[data-quiz-title]'));
const crumbEl = /** @type {HTMLElement} */ (qs('[data-crumb-title]'));
const metaHost = /** @type {HTMLElement} */ (qs('[data-quiz-badges]'));
const actionsHost = /** @type {HTMLElement} */ (qs('[data-editor-actions]'));
const bar = /** @type {HTMLElement} */ (qs('[data-editor-bar]'));
const loadingHost = /** @type {HTMLElement} */ (qs('[data-editor-loading]'));
const editorHost = /** @type {HTMLElement} */ (qs('[data-editor]'));
const bannersHost = /** @type {HTMLElement} */ (qs('[data-editor-banners]'));
const tablist = /** @type {HTMLElement} */ (qs('[data-tabs]'));
const tabButtons = /** @type {HTMLButtonElement[]} */ (qsa('[role="tab"]', tablist));
const form = /** @type {HTMLFormElement} */ (qs('[data-details-form]'));
const summaryHost = /** @type {HTMLElement} */ (qs('[data-details-summary]'));
const infoHost = /** @type {HTMLElement} */ (qs('[data-quiz-info]'));
const moreButton = /** @type {HTMLButtonElement} */ (qs('[data-more]'));
const previewButtons = /** @type {HTMLButtonElement[]} */ (qsa('[data-preview]'));
const primaryButtons = /** @type {HTMLButtonElement[]} */ (qsa('[data-primary-action]'));
/** @type {Record<string, HTMLInputElement | HTMLTextAreaElement>} */
const inputs = {
  title: /** @type {HTMLInputElement} */ (qs('#quiz-title')),
  description: /** @type {HTMLTextAreaElement} */ (qs('#quiz-description')),
  instructions: /** @type {HTMLTextAreaElement} */ (qs('#quiz-instructions'))
};

// State ------------------------------------------------------------------------------
const store = createStore({
  /** @type {Quiz | null} */
  quiz: null,
  /** @type {TabId} */
  tab: 'details',
  busy: false
});
/** @type {ReturnType<typeof createAutosave> | null} */
let saver = null;
/** @type {Admin | null} */
let admin = null;
let explicitSave = false;
/** @type {ReturnType<typeof createQuestionBuilder> | null} */
let builder = null;
/** Images uploading or failed in the question builder. */
let uploads = { pending: 0, failed: 0 };
/** @type {ReturnType<typeof createQuizAppearancePanel> | null} */
let appearancePanel = null;
/** @type {ReturnType<typeof createSettingsPanel> | null} */
let settingsPanel = null;
/** Latest Question Bank versions of the questions this quiz copied (Stage 8). */
const bankVersions = /** @type {Map<string, { version: number, status: string }>} */ (new Map());
/** Notes about a copy that was just made (Stage 7), shown until dismissed. */
let copyNotes = /** @type {string[]} */ ([]);

const saveStatus = createSaveStatus(qsa('[data-save-status]'), {
  onRetry: () => saver?.retry(),
  onSignIn: () => reauthenticate(),
  onConflict: () => qs('[data-banner="conflict"]')?.focus()
});

bootPage({
  page: 'quizzes',
  title: 'Quiz',
  onReady: (signedIn) => {
    admin = signedIn;
    load();
  }
});

// Loading ----------------------------------------------------------------------------

async function load() {
  loadingHost.hidden = false;
  editorHost.hidden = true;
  if (!quizId) {
    showProblem('notFound');
    return;
  }
  try {
    setup(await api.getQuiz(quizId));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();   // nothing has been typed yet, so nothing can be lost
      return;
    }
    showProblem(error instanceof ApiError && error.status === 404 ? 'notFound' : 'error', error);
  }
}

/** @param {'notFound' | 'error'} kind @param {unknown} [error] */
function showProblem(kind, error) {
  setTitle('Quiz not found');
  loadingHost.replaceChildren(kind === 'notFound'
    ? emptyState({
      iconName: 'searchX',
      title: 'We can’t find that quiz',
      message: 'It may have been deleted, or the link may be incomplete.',
      actions: [{ label: 'Back to quizzes', href: 'quizzes.html', variant: 'primary' }]
    })
    : errorState({ title: 'We couldn’t load this quiz', message: userMessage(error), onRetry: () => { loadingHost.replaceChildren(); load(); } }));
  if (kind === 'error') setTitle('Quiz');
}

/** @param {Quiz} quiz */
function setup(quiz) {
  store.set({ quiz });
  for (const field of QUIZ_DETAIL_FIELDS) {
    inputs[field].value = /** @type {any} */ (quiz)[field] || '';
    renderCounter(/** @type {keyof typeof DETAIL_LIMITS} */ (field));
  }

  saver?.destroy();
  saver = createAutosave({
    fields: QUIZ_DETAIL_FIELDS,
    values: savedValuesOf(quiz),
    version: quiz.version,
    validate: validateQuizDetails,
    diff: nextChange,
    commit: commitChange,
    save: (change, version) => saveChange(quiz.id, change, version),
    classify,
    onChange: onSaveState,
    onSaved: (updated) => {
      const current = store.get().quiz;
      if (current) store.set({ quiz: { ...current, .../** @type {Quiz} */ (updated), ...saver?.values() } });
      settingsPanel?.setSaved(/** @type {Quiz} */ (updated).settings);
      renderInfo();
    }
  });
  if (quiz.status === 'archived') saver.setReadonly(true);
  else saveStatus.render(saver.state);

  builder?.destroy();
  builder = createQuestionBuilder(/** @type {HTMLElement} */ (qs('#panel-questions')), {
    questions: quiz.questions,
    settings: quiz.settings,
    appearance: quiz.appearance,
    readOnly: questionsReadOnly(quiz),
    upload: (file, options) => api.uploadImage(file, options),
    isSaved: (id) => (saver?.savedValues().questions || []).some((/** @type {Question} */ q) => q.id === id),
    onChange: (questions) => {
      saver?.update('questions', questions);
      renderCounts();
    },
    onUploadsChange: (next) => {
      uploads = next;
      renderCounts();
      if (store.get().tab === 'review') renderReview();
    },
    bank: { onAdd: addFromBank, onSave: saveQuestionToBank, onReview: reviewBankUpdate }
  });
  loadBankVersions(quiz.questions);

  appearancePanel = createQuizAppearancePanel(/** @type {HTMLElement} */ (qs('[data-appearance-panel]')), {
    appearance: quiz.appearance,
    sample: () => liveQuiz().questions[0] || null,
    readOnly: quiz.status === 'archived',
    note: appearanceNote(quiz),
    onChange: (appearance) => {
      saver?.update('appearance', appearance);
      builder?.setState({ appearance });
      renderCounts();
    }
  });

  settingsPanel = createSettingsPanel(/** @type {HTMLElement} */ (qs('#panel-settings')), {
    settings: quiz.settings,
    saved: quiz.settings,
    locked: isLocked(quiz),
    readOnly: quiz.status === 'archived',
    onChange: (settings) => {
      saver?.update('settings', settings);
      builder?.setState({ settings });
      renderCounts();
    },
    onEditInstructions: () => {
      selectTab('details');
      requestAnimationFrame(() => {
        inputs.instructions.focus();
        inputs.instructions.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      });
    }
  });

  loadingHost.hidden = true;
  editorHost.hidden = false;
  actionsHost.hidden = false;
  bar.hidden = false;
  document.body.classList.add('has-editor-bar');
  editorHost.classList.add('fade-in');

  renderAll();
  selectTab(tabFromHash(), { push: false, animate: false });
  requestAnimationFrame(positionIndicator);

  const flash = takeFlash();
  if (flash?.notes?.length) {
    copyNotes = flash.notes;
    renderBanners();
  }
  if (flash) {
    toast({ type: flash.type, message: flash.message });
    if (store.get().tab === 'details' && quiz.status !== 'archived') {
      inputs.title.focus({ preventScroll: true });
      inputs.title.select();
    }
  }
}

/**
 * How a failed save should be handled.
 * @param {unknown} error
 * @returns {import('../core/autosave.js').FailureKind}
 */
function classify(error) {
  if (!(error instanceof ApiError)) return 'error';
  if (error.kind === 'network' || error.kind === 'timeout') return navigator.onLine ? 'error' : 'offline';
  if (error.status === 401) return 'auth';
  if (error.status === 409) return 'conflict';
  if (error.status === 404 && error.code === 'QUESTION_NOT_FOUND') return 'conflict';   // deleted somewhere else
  if (error.status === 404) return 'gone';
  if (error.status === 422 && error.code === 'QUESTIONS_LOCKED') return 'conflict';     // participants started meanwhile
  if (error.status === 422 && error.code === 'READ_ONLY') return 'readonly';
  if (error.status === 400 || error.status === 422) return 'invalid';
  return 'error';
}

/** What autosave compares against: details, settings, appearance and questions. @param {Quiz} quiz */
function savedValuesOf(quiz) {
  return {
    title: quiz.title, description: quiz.description, instructions: quiz.instructions,
    settings: quiz.settings, appearance: quiz.appearance, questions: quiz.questions
  };
}

/** Participants who are mid-quiz see appearance changes at once. @param {Pick<Quiz, 'status' | 'attemptCount'>} quiz */
function appearanceNote(quiz) {
  if (quiz.status === 'archived') return 'This quiz is archived, so its appearance is read-only. Restore it to make changes.';
  if (isLocked(quiz)) return 'Participants have started this quiz. Appearance can still change, and participants taking it now will see the change straight away.';
  return '';
}

/** @param {Pick<Quiz, 'status' | 'attemptCount'>} quiz @returns {null | 'locked' | 'archived'} */
function questionsReadOnly(quiz) {
  if (quiz.status === 'archived') return 'archived';
  return isLocked(quiz) ? 'locked' : null;
}

/**
 * The next thing to save: changed details first, then question changes in a
 * safe order (deletes, new questions, edits, then the new order).
 * @param {Record<string, any>} saved
 * @param {Record<string, any>} current
 * @returns {PendingChange | null}
 */
function nextChange(saved, current) {
  /** @type {Record<string, any>} */
  const details = diffFields(saved, current, QUIZ_DETAIL_FIELDS);
  for (const key of ['settings', 'appearance']) {
    if (current[key] && JSON.stringify(saved[key]) !== JSON.stringify(current[key])) details[key] = current[key];
  }
  if (Object.keys(details).length) return { kind: 'details', changes: details };
  const ops = questionOps(saved.questions || [], current.questions || []);
  return ops.length ? { kind: 'question', op: ops[0] } : null;
}

/**
 * What the server has once a change is saved.
 * @param {Record<string, any>} saved
 * @param {PendingChange} change
 */
function commitChange(saved, change) {
  if (change.kind === 'details') return { ...saved, ...change.changes };
  const { op } = change;
  /** @type {Question[]} */
  let list = saved.questions || [];
  if (op.kind === 'delete') list = list.filter((q) => q.id !== op.id);
  else if (op.kind === 'create') {
    list = list.slice();
    list.splice(op.position - 1, 0, op.question);
  } else if (op.kind === 'update') list = list.map((q) => (q.id === op.question.id ? op.question : q));
  else {
    const order = new Map(op.ids.map((id, index) => [id, index]));
    list = list.slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }
  return { ...saved, questions: list };
}

/**
 * Send one change. A failed question call carries the question's id, so the
 * editor can point at it.
 * @param {string} id
 * @param {PendingChange} change
 * @param {number} version
 */
async function saveChange(id, change, version) {
  if (change.kind === 'details') {
    const updated = await api.updateQuiz(id, change.changes, { version });
    return { version: updated.version, result: updated };
  }
  const { op } = change;
  try {
    const updated = op.kind === 'create' ? await api.createQuestion(id, op.question, { version, position: op.position })
      : op.kind === 'update' ? await api.updateQuestion(id, op.question, { version })
        : op.kind === 'delete' ? await api.deleteQuestion(id, op.id, { version })
          : await api.reorderQuestions(id, op.ids, { version });
    return { version: updated.version, result: updated };
  } catch (error) {
    if (error instanceof ApiError) /** @type {any} */ (error).questionId = op.kind === 'create' || op.kind === 'update' ? op.question.id : op.kind === 'delete' ? op.id : null;
    throw error;
  }
}

/** The quiz as it is right now, including what's been typed but not saved yet. */
function liveQuiz() {
  const quiz = /** @type {Quiz} */ (store.get().quiz);
  return { ...quiz, ...(saver ? saver.values() : {}) };
}

// Save status -------------------------------------------------------------------------

/**
 * @param {SaveState} state
 * @param {SaveState} previous
 */
function onSaveState(state, previous) {
  saveStatus.render(state);

  // Field errors (live while typing; a summary only after an explicit save)
  for (const field of QUIZ_DETAIL_FIELDS) {
    const message = state.fieldErrors[field];
    if (message) setFieldError(inputs[field], message, { shake: explicitSave });
    else clearFieldError(inputs[field]);
  }
  const questionId = /** @type {any} */ (state.error)?.questionId;
  if (state.status === 'invalid' && previous.status !== 'invalid' && questionId) {
    // The server turned down a question: say which one, and open it.
    const number = liveQuiz().questions.findIndex((q) => q.id === questionId) + 1;
    const detail = Object.values(state.fieldErrors)[0] || userMessage(state.error);
    toast({ type: 'error', message: number ? `Question ${number} couldn’t be saved. ${detail}` : `A question couldn’t be saved. ${detail}` });
    if (number && store.get().tab === 'questions') builder?.focusQuestion(questionId);
  }
  const otherErrors = Object.entries(state.fieldErrors).filter(([field]) => !QUIZ_DETAIL_FIELDS.includes(field));
  if (state.status === 'invalid' && previous.status !== 'invalid' && !questionId && otherErrors.length) {
    // Settings or appearance turned down by the server.
    toast({ type: 'error', message: `Couldn’t save that change. ${otherErrors[0][1]}` });
  }
  if (state.status === 'invalid' && explicitSave) {
    const items = Object.entries(state.fieldErrors)
      .filter(([field]) => QUIZ_DETAIL_FIELDS.includes(field))
      .map(([field, message]) => ({ fieldId: inputs[field].id, message }));
    if (items.length) {
      if (store.get().tab !== 'details') selectTab('details');
      showErrorSummary(summaryHost, items, { title: 'Fix this to save your changes' });
    }
  } else if (state.status !== 'invalid') hideFormMessage(summaryHost);
  explicitSave = false;

  if (state.status === 'auth' && previous.status !== 'auth') reauthenticate();
  if (state.status === 'saved' || state.status === 'conflict' || state.status === 'gone' || previous.status === 'conflict') renderBanners();
  if (state.status === 'saved') renderInfo();
}

async function reauthenticate() {
  const ok = await signInAgain({ identifier: admin?.email || '', reason: 'Your session ended while you were editing.' });
  if (!ok) return;
  toast({ type: 'success', message: 'Signed in again. Saving your changes…' });
  saver?.resume();
}

/** Save straight away, showing a summary if something needs fixing. */
async function saveNow() {
  if (!saver) return false;
  explicitSave = true;
  const ok = await saver.flush();
  explicitSave = false;
  return ok;
}

// Rendering --------------------------------------------------------------------------

function renderAll() {
  renderHeader();
  renderBanners();
  renderInfo();
  renderCounts();
  renderPanel(store.get().tab);
  setReadonly(store.get().quiz?.status === 'archived');
}

/** @param {string} title */
function setTitle(title) {
  const text = title.trim() || 'Untitled quiz';
  titleEl.textContent = text;
  titleEl.classList.toggle('is-untitled', !title.trim());
  crumbEl.textContent = text;
  document.title = `${text} · JCI Uniben Quiz Admin`;
  const topbar = qs('.topbar__title');
  if (topbar) topbar.textContent = text;
}

function renderHeader() {
  const quiz = /** @type {Quiz} */ (store.get().quiz);
  setTitle(inputs.title.value);
  const info = availabilityInfo(quiz);
  metaHost.replaceChildren(
    statusBadge(quiz.status),
    ...(info.availability ? [availabilityBadge(info.availability, { soon: info.soon })] : []),
    el('span', { class: ['editor-head__detail', info.soon ? 'is-soon' : ''], attrs: { title: info.title || null }, text: info.detail }),
    ...(isLocked(quiz) ? [el('span', { class: 'badge badge--locked' }, icon('lock', { size: 14 }), el('span', { text: `${plural(quiz.attemptCount, 'attempt')}` }))] : [])
  );

  const labels = { draft: 'Publish…', published: 'Unpublish…', archived: 'Restore' };
  primaryButtons.forEach((button) => {
    const label = button.querySelector('.btn__label');
    if (label) label.textContent = labels[quiz.status];
    button.classList.toggle('btn--primary', quiz.status !== 'published');
  });
}

/** Banners: archived, locked, live, and the save problems that need a decision. */
function renderBanners() {
  const quiz = /** @type {Quiz} */ (store.get().quiz);
  const status = saver?.state.status;
  /** @type {HTMLElement[]} */
  const banners = [];
  /**
   * @param {string} id
   * @param {'info' | 'warning' | 'danger'} tone
   * @param {string} iconName
   * @param {string} title
   * @param {string} text
   * @param {HTMLElement[]} [actions]
   */
  const banner = (id, tone, iconName, title, text, actions = []) => el('div', {
    class: ['editor-banner', `editor-banner--${tone}`],
    attrs: { role: tone === 'danger' ? 'alert' : null, tabindex: '-1' },
    data: { banner: id }
  },
  icon(iconName, { size: 20, className: 'editor-banner__icon' }),
  el('div', { class: 'editor-banner__body' }, el('p', { class: 'editor-banner__title', text: title }), el('p', { text })),
  actions.length ? el('div', { class: 'editor-banner__actions' }, actions) : null);
  const button = (/** @type {string} */ label, /** @type {() => void} */ onClick, primary = false) =>
    el('button', { type: 'button', class: ['btn', 'btn--small', primary ? 'btn--primary' : ''], on: { click: onClick } }, el('span', { class: 'btn__label', text: label }));

  if (status === 'conflict') {
    const code = /** @type {any} */ (saver?.state.error)?.code;
    const actions = [button('Load the latest version', loadLatest, true), button('Copy my changes', copyMyChanges)];
    if (code === 'QUESTIONS_LOCKED') {
      banners.push(banner('conflict', 'danger', 'lock', 'Participants have started this quiz',
        'Its questions are now locked to protect their results, so your latest question changes can’t be saved. Copy them if you want to keep them, then load the latest version.', actions));
    } else {
      banners.push(banner('conflict', 'danger', 'alertTriangle', 'This quiz was changed somewhere else',
        code === 'QUESTION_NOT_FOUND'
          ? 'A question you were editing was deleted somewhere else. Autosave has stopped so nothing gets overwritten; your changes are still here on this page.'
          : 'Autosave has stopped so nothing gets overwritten. Your latest changes are still here on this page.', actions));
    }
  }
  if (status === 'gone') {
    banners.push(banner('gone', 'danger', 'alertTriangle', 'This quiz no longer exists',
      'It may have been deleted somewhere else, so your changes can’t be saved. Copy them if you want to keep them.',
      [button('Copy my changes', copyMyChanges, true), button('Back to quizzes', () => { window.location.href = 'quizzes.html'; })]));
  }
  if (copyNotes.length) {
    banners.push(el('div', { class: 'editor-banner editor-banner--info', attrs: { tabindex: '-1' }, data: { banner: 'copy' } },
      icon('copy', { size: 20, className: 'editor-banner__icon' }),
      el('div', { class: 'editor-banner__body' },
        el('p', { class: 'editor-banner__title', text: 'About this copy' }),
        el('ul', { class: 'copy-notes' }, copyNotes.map((note) => el('li', { class: note.startsWith('Not copied') ? 'is-warning' : '', text: note })))),
      el('div', { class: 'editor-banner__actions' },
        button('Got it', () => { copyNotes = []; renderBanners(); }))));
  }
  if (quiz.status === 'archived') {
    banners.push(banner('archived', 'info', 'archive', 'This quiz is archived',
      'It’s read-only and hidden from participants and your active lists. Restore it to make changes.',
      [button('Restore', () => runStatusAction('restore'), true)]));
  } else if (isLocked(quiz)) {
    banners.push(banner('locked', 'warning', 'lock', 'Questions are locked',
      'Participants have already started this quiz, so its questions are locked to protect their results. Duplicate the quiz to make changes.',
      [button('Duplicate', () => runStatusAction('duplicate'))]));
  } else if (quiz.status === 'published') {
    banners.push(banner('live', 'info', 'info', 'This quiz is live',
      'Saved changes appear to participants immediately.'));
  }
  const before = new Set(qsa('[data-banner]', bannersHost).map((node) => node.dataset.banner));
  bannersHost.replaceChildren(...banners);
  banners.forEach((node) => { if (!before.has(node.dataset.banner)) node.classList.add('is-entering'); });
}

function renderInfo() {
  if (!store.get().quiz) return;
  const quiz = liveQuiz();
  /** @type {[string, string][]} */
  const rows = [
    ['Questions', formatNumber(quiz.questions.length)],
    ['Total marks', formatNumber(totalMarks(quiz.questions))],
    ['Participant attempts', formatNumber(quiz.attemptCount)],
    ['Created', formatDateTime(quiz.createdAt)],
    ['Last saved', formatRelative(quiz.updatedAt)]
  ];
  infoHost.replaceChildren(...rows.map(([term, value]) =>
    el('div', { class: 'facts__row' }, el('dt', { text: term }), el('dd', { class: 'num', text: value }))));
}

function renderCounts() {
  const quiz = liveQuiz();
  const { blockers } = publishIssues(quiz, { uploads });
  const questionCount = /** @type {HTMLElement} */ (qs('[data-count="questions"]', tablist));
  const reviewCount = /** @type {HTMLElement} */ (qs('[data-count="review"]', tablist));
  questionCount.textContent = String(quiz.questions.length);
  qs('#tab-questions')?.setAttribute('aria-label', `Questions, ${plural(quiz.questions.length, 'question')}`);
  const issues = quiz.status === 'draft' ? blockers.length : 0;
  reviewCount.hidden = issues === 0;
  reviewCount.textContent = String(issues);
  qs('#tab-review')?.setAttribute('aria-label', issues ? `Review & Publish, ${plural(issues, 'issue')} to fix` : 'Review & Publish');
}

/** @param {boolean} on */
function setReadonly(on) {
  form.classList.toggle('is-readonly', on);
  const quiz = store.get().quiz;
  if (quiz) {
    builder?.setState({ readOnly: questionsReadOnly(quiz) });
    appearancePanel?.setReadOnly(on, appearanceNote(quiz));
  }
  for (const field of QUIZ_DETAIL_FIELDS) {
    inputs[field].readOnly = on;
    if (on) inputs[field].setAttribute('aria-readonly', 'true');
    else inputs[field].removeAttribute('aria-readonly');
  }
}

/** Character counters: amber near the limit, red over it. */
function renderCounter(/** @type {keyof typeof DETAIL_LIMITS} */ field) {
  const out = qs(`[data-count-for="${field}"]`, form);
  if (!out) return;
  const max = DETAIL_LIMITS[field];
  const length = inputs[field].value.length;
  out.textContent = `${formatNumber(length)} / ${formatNumber(max)}`;
  out.classList.toggle('is-near', length > max * .9 && length <= max);
  out.classList.toggle('is-over', length > max);
}

// Tabs -------------------------------------------------------------------------------

/** @returns {TabId} */
function tabFromHash() {
  const hash = window.location.hash.replace('#', '');
  return /** @type {TabId} */ (TABS.includes(/** @type {TabId} */ (hash)) ? hash : 'details');
}

/**
 * @param {TabId} tab
 * @param {{ push?: boolean, focus?: boolean, animate?: boolean }} [options]
 */
function selectTab(tab, { push = true, focus = false, animate = true } = {}) {
  const previous = store.get().tab;
  if (previous === 'details' && tab !== 'details') saver?.flush();   // switching tabs saves straight away
  store.set({ tab });
  tabButtons.forEach((button) => {
    const on = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
    const panel = /** @type {HTMLElement} */ (document.getElementById(/** @type {string} */ (button.getAttribute('aria-controls'))));
    panel.hidden = !on;
    if (on && animate && previous !== tab) {
      panel.classList.remove('is-entering');
      void panel.offsetWidth;
      panel.classList.add('is-entering');
    }
  });
  renderPanel(tab);
  positionIndicator();
  const active = tabButtons.find((button) => button.dataset.tab === tab);
  active?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  if (focus) active?.focus();
  if (push && window.location.hash.replace('#', '') !== tab) {
    window.history.pushState(null, '', `#${tab}`);
  }
}

function positionIndicator() {
  const active = tabButtons.find((button) => button.getAttribute('aria-selected') === 'true');
  if (!active) return;
  tablist.style.setProperty('--ind-x', String(active.offsetLeft));
  tablist.style.setProperty('--ind-w', String(active.offsetWidth));
}

tabButtons.forEach((button, index) => {
  button.addEventListener('click', () => selectTab(/** @type {TabId} */ (button.dataset.tab)));
  button.addEventListener('keydown', (event) => {
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabButtons.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = tabButtons[(/** @type {Record<string, number>} */ (keys)[event.key] + tabButtons.length) % tabButtons.length];
    selectTab(/** @type {TabId} */ (next.dataset.tab), { focus: true });
  });
});
window.addEventListener('popstate', () => { if (store.get().quiz) selectTab(tabFromHash(), { push: false }); });
if ('ResizeObserver' in window) new ResizeObserver(positionIndicator).observe(tablist);
document.fonts?.ready.then(positionIndicator);

// Panels -----------------------------------------------------------------------------

/** @param {TabId} tab */
function renderPanel(tab) {
  if (!store.get().quiz) return;
  if (tab === 'details') appearancePanel?.refreshSample();
  if (tab === 'review') renderReview();
}

function renderReview() {
  const quiz = liveQuiz();
  const panel = /** @type {HTMLElement} */ (qs('#panel-review'));
  const { blockers, warnings } = publishIssues(quiz, { uploads });
  /** @type {Record<string, number>} */
  const byType = {};
  quiz.questions.forEach((q) => { byType[q.type] = (byType[q.type] || 0) + 1; });
  const typeSummary = Object.entries(byType).map(([type, n]) => `${n} ${(/** @type {any} */ (QUESTION_TYPE_LABELS))[type].toLowerCase()}`).join(', ');
  const s = quiz.settings;

  /** @param {PublishIssue} issue @param {'blocker' | 'warning'} kind */
  const item = (issue, kind) => el('li', { class: ['checklist__item', `checklist__item--${kind}`] },
    icon(kind === 'blocker' ? 'alertCircle' : 'alertTriangle', { size: 18, className: 'checklist__icon' }),
    el('span', { class: 'checklist__text', text: issue.message }),
    el('button', { type: 'button', class: 'btn btn--small', on: { click: () => goToIssue(issue) } },
      el('span', { class: 'btn__label', text: kind === 'blocker' ? 'Fix' : 'Review' }), el('span', { class: 'sr-only', text: `: ${issue.message}` })));

  const preset = matchPreset(quiz.appearance);
  /** @type {[string, string][]} */
  const rows = [
    ['Title', quiz.title.trim() || 'Untitled quiz'],
    ['Questions', quiz.questions.length ? formatNumber(quiz.questions.length) : 'None yet'],
    ...(typeSummary ? [/** @type {[string, string]} */ (['Question types', typeSummary])] : []),
    ['Total marks', formatNumber(totalMarks(quiz.questions))],
    ['Time limit', s.durationMinutes ? plural(s.durationMinutes, 'minute') : 'No time limit'],
    ['Opens', s.opensAt ? formatDateTime(s.opensAt) : 'As soon as it’s published'],
    ['Closes', s.closesAt ? formatDateTime(s.closesAt) : 'No close time'],
    ['Attempts', s.maxAttempts === null ? 'Unlimited' : `${formatNumber(s.maxAttempts)}${s.maxAttempts > 1 ? ` (${SETTING_LABELS.attemptScoring[s.attemptScoring].toLowerCase()} counts)` : ''}`],
    ['Results', SETTING_LABELS.resultVisibility[s.resultVisibility]],
    ['Correct answers', s.showCorrectAnswers ? 'Shown with results' : 'Not shown'],
    ['Appearance', `${preset ? preset.name : 'Custom colours'} · ${quiz.appearance.fontFamily} ${quiz.appearance.fontSize}px`]
  ];
  const summary = el('dl', { class: 'facts' }, rows.map(([term, value]) =>
    el('div', { class: 'facts__row' }, el('dt', { text: term }), el('dd', { class: 'num', text: value }))));

  const previewButton = el('button', { type: 'button', class: 'btn', on: { click: () => openPreview(previewButton) } },
    icon('eye', { size: 18 }), el('span', { class: 'btn__label', text: 'Preview as participant' }));

  const publishBox = (() => {
    if (quiz.status === 'published') {
      return el('div', { class: 'publish-done' },
        el('span', { class: 'publish-done__icon', attrs: { 'aria-hidden': 'true' } }, icon('checkCircle', { size: 22 })),
        el('div', { class: 'publish-done__body' },
          el('p', { class: 'publish-done__title', text: 'This quiz is published' }),
          el('p', { text: s.opensAt && Date.parse(s.opensAt) > Date.now()
            ? `Participants can start it from ${formatDateTime(s.opensAt)}.`
            : 'Participants can take it now.' }),
          el('div', { class: 'publish-done__actions' },
            previewButton,
            el('a', { class: 'btn btn--ghost', href: 'quizzes.html' }, icon('arrowLeft', { size: 18 }), el('span', { class: 'btn__label', text: 'Back to quizzes' })))));
    }
    if (quiz.status === 'archived') {
      return el('div', { class: 'publish-box__row' }, previewButton,
        el('p', { class: 'publish-box__note' }, icon('archive', { size: 18 }), 'This quiz is archived. Restore it to publish it again.'));
    }
    const helpId = 'publish-help';
    const button = el('button', {
      type: 'button',
      class: 'btn btn--primary',
      disabled: blockers.length > 0,
      attrs: { 'aria-describedby': helpId },
      on: { click: () => runStatusAction('publish') }
    }, icon('send', { size: 18 }), el('span', { class: 'btn__label', text: 'Publish quiz…' }));
    return el('div', { class: 'publish-box__row' }, previewButton, button,
      el('p', { class: 'publish-box__help', id: helpId, text: blockers.length
        ? `Fix the ${plural(blockers.length, 'issue')} above first.`
        : 'You’ll see the key facts once more before anything goes live.' }));
  })();

  panel.replaceChildren(
    el('div', { class: 'panel-head' },
      el('h2', { class: 'panel-title', text: 'Review & Publish' }),
      el('p', { class: 'panel-lede', text: 'Check everything before participants see it.' })),
    el('div', { class: 'panel-grid' },
      el('section', { class: 'card', attrs: { 'aria-labelledby': 'checks-title' } },
        el('h3', { class: 'card-title', id: 'checks-title', text: blockers.length ? 'Fix before publishing' : 'Ready to publish' }),
        blockers.length
          ? el('ul', { class: 'checklist' }, blockers.map((issue) => item(issue, 'blocker')))
          : el('p', { class: 'checklist__ok' }, icon('checkCircle', { size: 18 }), 'Nothing is blocking this quiz.'),
        warnings.length ? el('h3', { class: 'card-title card-title--sub', text: 'Worth a look' }) : null,
        warnings.length ? el('p', { class: 'card__description', text: 'You can publish with these, but check they’re what you want.' }) : null,
        warnings.length ? el('ul', { class: 'checklist' }, warnings.map((issue) => item(issue, 'warning'))) : null,
        el('div', { class: 'publish-box' }, publishBox)),
      el('section', { class: 'card', attrs: { 'aria-labelledby': 'summary-title' } },
        el('h3', { class: 'card-title', id: 'summary-title', text: 'Summary' }),
        summary))
  );
}

/** @param {PublishIssue} issue */
function goToIssue(issue) {
  selectTab(issue.tab);
  requestAnimationFrame(() => {
    if (issue.questionId && builder) {
      builder.focusQuestion(issue.questionId, issue.target);
      return;
    }
    if ((issue.id === 'uploading' || issue.id === 'upload-failed') && builder) {
      builder.focusUploads();
      return;
    }
    if (issue.tab === 'settings' && issue.field && settingsPanel) {
      settingsPanel.focus(issue.field);
      return;
    }
    if (issue.field === 'appearance') {
      const panel = qs('[data-appearance-panel]');
      panel?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      qs('#appearance-textColor')?.focus({ preventScroll: true });
      return;
    }
    if (issue.field && inputs[issue.field]) {
      inputs[issue.field].focus();
      inputs[issue.field].scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    const target = issue.questionId ? document.getElementById(`q-${issue.questionId}`) : null;
    const focusTarget = target || /** @type {HTMLElement} */ (qs(`#panel-${issue.tab}`));
    focusTarget.setAttribute('tabindex', '-1');
    focusTarget.focus();
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      target.classList.remove('is-highlighted');
      void target.offsetWidth;
      target.classList.add('is-highlighted');
    }
  });
}

// Typing ------------------------------------------------------------------------------

for (const field of QUIZ_DETAIL_FIELDS) {
  const input = inputs[field];
  input.addEventListener('input', () => {
    saver?.update(field, input.value);
    renderCounter(/** @type {keyof typeof DETAIL_LIMITS} */ (field));
    if (field === 'title') setTitle(input.value);
    renderCounts();
  });
  input.addEventListener('change', () => saver?.flush());   // leaving a field saves straight away
  renderCounter(/** @type {keyof typeof DETAIL_LIMITS} */ (field));
}
form.addEventListener('submit', (event) => { event.preventDefault(); saveNow(); });

// Ctrl/Cmd + S saves immediately.
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!saver) return;
    if (saver.state.status === 'readonly') {
      toast({ message: 'This quiz is read-only. Restore it to make changes.' });
      return;
    }
    saveNow().then((ok) => { if (ok) announce('All changes saved.'); });
  }
});

// Never lose work by leaving.
window.addEventListener('beforeunload', (event) => {
  if (saver?.hasUnsaved() || uploads.pending) {
    event.preventDefault();
    event.returnValue = '';
  }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saver?.flush(); });

// Header actions ----------------------------------------------------------------------

/** Everything typed must be saved before an action changes the quiz. */
async function readyForAction() {
  if (uploads.pending) {
    toast({ message: `${uploads.pending === 1 ? 'An image is' : `${uploads.pending} images are`} still uploading. Try again once ${uploads.pending === 1 ? 'it’s' : 'they’re'} done.` });
    return false;
  }
  if (!saver || !saver.hasUnsaved()) return true;
  const ok = await saveNow();
  if (!ok && saver.hasUnsaved()) {
    toast({ type: 'error', message: 'Your latest changes aren’t saved yet. Fix that first, then try again.' });
    return false;
  }
  return true;
}

/** @param {boolean} busy */
function setActionsBusy(busy) {
  store.set({ busy });
  primaryButtons.forEach((button) => setButtonLoading(button, busy));
  moreButton.disabled = busy;
}

/** @param {Quiz} updated @param {{ morph?: boolean }} [options] */
function applyServerQuiz(updated, { morph = false } = {}) {
  const current = /** @type {Quiz} */ (store.get().quiz);
  store.set({ quiz: { ...current, ...updated, ...(saver ? saver.values() : {}) } });
  saver?.setVersion(updated.version);
  saver?.setReadonly(updated.status === 'archived');
  builder?.setState({ readOnly: questionsReadOnly(updated), settings: updated.settings });
  settingsPanel?.set(liveQuiz().settings, { saved: updated.settings, locked: isLocked(updated), readOnly: updated.status === 'archived' });
  renderAll();
  if (morph) {
    const badge = metaHost.querySelector('.badge');
    badge?.classList.add('badge--morph');
    badge?.querySelector('svg')?.classList.add('check-draw');
  }
}

/** @type {import('../quiz/quiz-actions.js').ActionHooks} */
const hooks = {
  onBusy: setActionsBusy,
  onUnauthorized: async () => {
    const ok = await signInAgain({ identifier: admin?.email || '', reason: 'Your session ended.' });
    if (ok) toast({ type: 'success', message: 'Signed in again. Please try that once more.' });
  },
  onNotFound: () => {
    if (saver) saver.destroy();
    window.location.href = 'quizzes.html';
  }
};

/** @param {string[]} problems */
async function notReady(problems) {
  const choice = await openDialog({
    title: 'This quiz isn’t ready to publish',
    body: [
      `Fix ${problems.length === 1 ? 'this' : 'these'} first:`,
      el('ul', { class: 'problem-list' }, problems.map((problem) => el('li', {}, icon('alertCircle', { size: 16 }), el('span', { text: problem }))))
    ],
    actions: [
      { label: 'Close', value: 'close', variant: 'ghost' },
      { label: 'Go to Review & Publish', value: 'review', variant: 'primary', autofocus: true }
    ]
  });
  if (choice === 'review') selectTab('review', { focus: true });
}

/** @param {'publish' | 'unpublish' | 'restore' | 'archive' | 'delete' | 'duplicate'} action */
async function runStatusAction(action) {
  if (store.get().busy || !store.get().quiz) return;
  if (action !== 'restore' && !(await readyForAction())) return;
  const quiz = liveQuiz();
  const summary = { ...quiz, questionCount: quiz.questions.length };
  if (action === 'publish') {
    const { blockers } = publishIssues(quiz, { uploads });
    const published = await publishQuiz(summary, { ...hooks, blockers: blockers.map((b) => b.message), onNotReady: notReady });
    if (published) applyServerQuiz(published, { morph: true });
  } else if (action === 'unpublish') {
    const updated = await unpublishQuiz(summary, hooks);
    if (updated) applyServerQuiz(updated);
  } else if (action === 'restore') {
    const updated = await restoreQuiz(summary, hooks);
    if (updated) applyServerQuiz(updated);
  } else if (action === 'archive') {
    const updated = await archiveQuiz(summary, hooks);
    if (updated) applyServerQuiz(updated);
  } else if (action === 'delete') {
    const result = await deleteQuiz(summary, hooks);
    if (result && 'archived' in result) applyServerQuiz(result.archived);
    else if (result) {
      saver?.destroy();
      saver = null;
      setFlash({ type: 'success', message: `Deleted ${quizName(summary)}.` });
      window.location.href = 'quizzes.html';
    }
  } else if (action === 'duplicate') {
    await duplicateQuiz(summary, hooks);
  }
}

primaryButtons.forEach((button) => button.addEventListener('click', () => {
  const status = store.get().quiz?.status;
  runStatusAction(status === 'published' ? 'unpublish' : status === 'archived' ? 'restore' : 'publish');
}));

menuButtonAttrs(moreButton);
moreButton.addEventListener('click', () => openMore());
moreButton.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openMore(event.key === 'ArrowUp' ? 'last' : 'first');
  }
});
/** @param {'first' | 'last'} [focus] */
function openMore(focus = 'first') {
  const quiz = store.get().quiz;
  if (!quiz || store.get().busy) return;
  /** @type {import('../components/menu.js').MenuItem[]} */
  const items = [{ id: 'duplicate', label: 'Duplicate', icon: 'copy' }];
  if (quiz.status !== 'archived') items.push({ id: 'archive', label: 'Archive…', icon: 'archive' });
  if (quiz.status === 'draft') items.push({ id: 'delete', label: 'Delete…', icon: 'trash', tone: 'danger', separatorBefore: true });
  showMenu(moreButton, items, {
    label: 'More actions for this quiz',
    focus,
    onSelect: (id) => runStatusAction(/** @type {any} */ (id))
  });
}

/** Save first, then open Preview (it shows the saved quiz). @param {HTMLButtonElement} button */
async function openPreview(button) {
  if (!store.get().quiz) return;
  setButtonLoading(button, true);
  const ok = await readyForAction();
  setButtonLoading(button, false);
  if (ok) window.location.href = `quiz-preview.html?id=${encodeURIComponent(quizId)}`;
}
previewButtons.forEach((button) => button.addEventListener('click', () => openPreview(button)));

// Conflicts and copies -----------------------------------------------------------------

async function loadLatest() {
  if (!saver) return;
  if (saver.hasUnsaved()) {
    const confirmed = await confirmDialog({
      title: 'Load the latest version?',
      message: [
        'Your unsaved changes on this page will be replaced by the version saved elsewhere.',
        'Copy your changes first if you want to keep them.'
      ],
      confirmLabel: 'Load latest version',
      cancelLabel: 'Keep my changes for now',
      tone: 'danger'
    });
    if (!confirmed) return;
  }
  try {
    const latest = await api.getQuiz(quizId);
    for (const field of QUIZ_DETAIL_FIELDS) inputs[field].value = /** @type {any} */ (latest)[field] || '';
    saver.reset(savedValuesOf(latest), latest.version);
    store.set({ quiz: latest });
    builder?.setQuestions(latest.questions);
    loadBankVersions(latest.questions);
    builder?.setState({ readOnly: questionsReadOnly(latest), settings: latest.settings, appearance: latest.appearance });
    appearancePanel?.set(latest.appearance);
    settingsPanel?.set(latest.settings, { saved: latest.settings, locked: isLocked(latest), readOnly: latest.status === 'archived' });
    QUIZ_DETAIL_FIELDS.forEach((field) => renderCounter(/** @type {keyof typeof DETAIL_LIMITS} */ (field)));
    renderAll();
    toast({ type: 'success', message: 'Loaded the latest version. Autosave is back on.' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { reauthenticate(); return; }
    toast({ type: 'error', message: `Couldn’t load the latest version. ${userMessage(error)}` });
  }
}

function copyMyChanges() {
  const values = saver ? saver.values() : {};
  const questions = /** @type {Question[]} */ (values.questions || []);
  const text = [
    `Title: ${values.title || ''}`,
    `Description:\n${values.description || ''}`,
    `Instructions:\n${values.instructions || ''}`,
    questions.length ? `Questions:\n\n${questionsToText(questions)}` : ''
  ].filter(Boolean).join('\n\n');
  const done = () => toast({ type: 'success', message: questions.length ? 'Copied your details and questions.' : 'Copied your title, description and instructions.' });
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => toast({ type: 'error', message: 'Couldn’t copy. Select the text in each field and copy it by hand.' }));
  else toast({ type: 'error', message: 'Copying isn’t available here. Select the text in each field and copy it by hand.' });
}

// Question Bank (Stage 8) ----------------------------------------------------------------

/**
 * Ask the bank for the latest version of every question this quiz copied, so
 * the builder can say "Newer version available". Failures are quiet: the
 * quiz still works without this.
 * @param {Question[]} questions
 */
async function loadBankVersions(questions) {
  const ids = [...new Set(questions.map((q) => q.source?.bankQuestionId).filter((id) => typeof id === 'string'))];
  if (!ids.length) return;
  const results = await Promise.allSettled(ids.map((id) => api.getBankQuestion(/** @type {string} */ (id))));
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') bankVersions.set(/** @type {string} */ (ids[index]), { version: result.value.version, status: result.value.status });
  });
  builder?.setBankVersions(new Map(bankVersions));
}

/** "Add from Question Bank": copies go in at `at` (after the open question). @param {number} at */
async function addFromBank(at) {
  const quiz = liveQuiz();
  const picked = await pickFromBank({ quizAppearance: quiz.appearance });
  if (!picked?.length || !builder) return;
  picked.forEach((bq) => bankVersions.set(bq.id, { version: bq.version, status: bq.status }));
  builder.setBankVersions(new Map(bankVersions));
  builder.insertQuestions(picked.map(questionFromBank), at);
  toast({ type: 'success', message: `Added ${plural(picked.length, 'question')} from the Question Bank.` });
}

/** "Save to Question Bank": a new bank question, and this one is linked to it. @param {Question} question */
async function saveQuestionToBank(question) {
  const saved = await saveToBank(question);
  if (!saved || !builder) return;
  bankVersions.set(saved.id, { version: saved.version, status: saved.status });
  builder.setBankVersions(new Map(bankVersions));
  builder.setSource(question.id, { bankQuestionId: saved.id, bankVersion: saved.version });
  toast({
    type: 'success',
    message: 'Saved to the Question Bank as a new question (version 1).',
    action: { label: 'Open in bank', onClick: () => { window.location.href = `question-edit.html?id=${encodeURIComponent(saved.id)}`; } }
  });
}

/**
 * "Review update": this quiz's copy next to the bank's newer version.
 * @param {Question} question
 * @param {boolean} editable
 */
async function reviewBankUpdate(question, editable) {
  if (!question.source) return;
  let bankQuestion;
  try {
    bankQuestion = await api.getBankQuestion(question.source.bankQuestionId);
  } catch (error) {
    toast({ type: 'error', message: `Couldn’t load the bank version. ${userMessage(error)}` });
    return;
  }
  const quiz = liveQuiz();
  const lock = questionsReadOnly(quiz);
  const update = await reviewUpdate({
    question,
    bankQuestion,
    quizAppearance: quiz.appearance,
    canUpdate: editable && !lock,
    lockedMessage: lock === 'locked'
      ? 'Participants have started this quiz, so its questions are locked to protect their results. Duplicate the quiz to use the new version.'
      : 'This quiz is archived. Restore it to update its questions.'
  });
  if (!update || !builder) return;
  const number = liveQuiz().questions.findIndex((q) => q.id === question.id) + 1;
  builder.replaceQuestion(question.id, { ...questionFromBank(bankQuestion), id: question.id });
  toast({ type: 'success', message: `Question ${number} now uses version ${bankQuestion.version} from the bank.` });
}
