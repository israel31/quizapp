// @ts-check
/**
 * The Question Bank editor (question-edit.html?id=… or ?new, section 16).
 * - The same question editor as quizzes (types, options, images, marks,
 *   appearance), for one question.
 * - An explicit Save button (not autosave), with "Unsaved changes" shown and
 *   a warning before leaving. Ctrl/Cmd+S saves.
 * - Saving a content change makes a new VERSION. A banner explains that
 *   quizzes already using the question keep their own copy.
 * - Tags; Archive / Restore; Delete only when no quiz has used it.
 */
import { api } from '../api/index.js';
import { ApiError, userMessage } from '../api/client.js';
import { DEFAULT_SETTINGS } from '../api/adapters.js';
import { el, qs } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { formatDateTime, formatRelative, formatNumber, plural } from '../core/format.js';
import { redirectToLogin } from '../core/session.js';
import { setFlash, takeFlash } from '../core/flash.js';
import { bootPage } from '../components/shell.js';
import { toast } from '../components/toast.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { showMenu, menuButtonAttrs } from '../components/menu.js';
import { emptyState, errorState } from '../components/states.js';
import { setButtonLoading } from '../components/button.js';
import { signInAgain } from '../components/sign-in-dialog.js';
import { createTagInput } from '../components/tag-input.js';
import { createQuestionBuilder } from '../quiz/question-builder.js';
import { createQuestion, validateQuestion } from '../quiz/question-types.js';
import { questionKey } from '../quiz/question-model.js';
import { renderQuestion } from '../quiz/renderer.js';
import { DEFAULT_APPEARANCE, loadFonts, resolveAppearance } from '../quiz/appearance.js';

/** @typedef {import('../types.js').BankQuestion} BankQuestion */
/** @typedef {import('../types.js').Question} Question */

const params = new URLSearchParams(window.location.search);
let bankId = params.get('id') || '';
const isNewPage = !bankId && params.has('new');

const titleEl = /** @type {HTMLElement} */ (qs('[data-bank-title]'));
const crumbEl = /** @type {HTMLElement} */ (qs('[data-crumb-title]'));
const badgesHost = /** @type {HTMLElement} */ (qs('[data-bank-badges]'));
const actionsHost = /** @type {HTMLElement} */ (qs('[data-bank-actions]'));
const stateEl = /** @type {HTMLElement} */ (qs('[data-bank-state]'));
const saveButton = /** @type {HTMLButtonElement} */ (qs('[data-bank-save]'));
const moreButton = /** @type {HTMLButtonElement} */ (qs('[data-bank-more]'));
const loadingHost = /** @type {HTMLElement} */ (qs('[data-bank-loading]'));
const mainHost = /** @type {HTMLElement} */ (qs('[data-bank-main]'));
const bannersHost = /** @type {HTMLElement} */ (qs('[data-bank-banners]'));
const editorHost = /** @type {HTMLElement} */ (qs('[data-bank-editor]'));
const tagsHost = /** @type {HTMLElement} */ (qs('[data-bank-tags]'));
const infoHost = /** @type {HTMLElement} */ (qs('[data-bank-info]'));
const previewHost = /** @type {HTMLElement} */ (qs('[data-bank-preview]'));

/** What the server has (null for a new question). @type {BankQuestion | null} */
let saved = null;
/** The question as it is on the page. @type {Question} */
let current = /** @type {any} */ (null);
let tags = /** @type {string[]} */ ([]);
let savedTags = /** @type {string[]} */ ([]);
let uploads = { pending: 0, failed: 0 };
let saving = false;
let previewFrame = 0;
/** @type {ReturnType<typeof createQuestionBuilder> | null} */
let builder = null;
/** @type {ReturnType<typeof createTagInput> | null} */
let tagInput = null;
/** @type {import('../types.js').Admin | null} */
let admin = null;

bootPage({
  page: 'question-bank',
  title: 'Question',
  onReady: (signedIn) => {
    admin = signedIn;
    load();
  }
});

async function load() {
  loadingHost.hidden = false;
  mainHost.hidden = true;
  if (!bankId && !isNewPage) {
    showProblem('notFound');
    return;
  }
  if (!bankId) {
    setup(null);
    return;
  }
  try {
    setup(await api.getBankQuestion(bankId));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    showProblem(error instanceof ApiError && error.status === 404 ? 'notFound' : 'error', error);
  }
}

/** @param {'notFound' | 'error'} kind @param {unknown} [error] */
function showProblem(kind, error) {
  setTitle(kind === 'notFound' ? 'Question not found' : 'Question');
  loadingHost.replaceChildren(kind === 'notFound'
    ? emptyState({
      iconName: 'searchX',
      title: 'We can’t find that question',
      message: 'It may have been deleted from the Question Bank, or the link may be incomplete.',
      actions: [{ label: 'Back to the Question Bank', href: 'question-bank.html', variant: 'primary' }]
    })
    : errorState({ title: 'We couldn’t load this question', message: userMessage(error), onRetry: () => { loadingHost.replaceChildren(); load(); } }));
}

/** The editable content of a bank question, as a quiz-style question. @param {BankQuestion} bq @returns {Question} */
function asQuestion(bq) {
  const { tags: t, status, version, usedInQuizCount, createdAt, updatedAt, ...content } = bq;
  return /** @type {Question} */ ({ ...JSON.parse(JSON.stringify(content)), order: 0, source: null });
}

/** @param {BankQuestion | null} bq */
function setup(bq) {
  saved = bq;
  current = bq ? asQuestion(bq) : createQuestion('multiple_choice');
  tags = bq ? bq.tags.slice() : [];
  savedTags = tags.slice();

  builder?.destroy();
  builder = createQuestionBuilder(editorHost, {
    mode: 'single',
    questions: [current],
    settings: DEFAULT_SETTINGS,
    appearance: DEFAULT_APPEARANCE,
    readOnly: bq?.status === 'archived' ? 'archived' : null,
    lockMessage: 'Read-only: this question is archived. Restore it to make changes.',
    upload: (file, options) => api.uploadImage(file, options),
    onChange: (questions) => {
      current = questions[0];
      renderState();
      schedulePreview();
    },
    onUploadsChange: (next) => {
      uploads = next;
      renderState();
    }
  });

  tagInput = createTagInput({
    id: 'bank-tags',
    tags,
    onChange: (next) => { tags = next; renderState(); },
    disabled: bq?.status === 'archived',
    describedBy: 'bank-tags-hint'
  });
  tagsHost.replaceChildren(tagInput.element);
  api.listBankTags().then((list) => tagInput?.setSuggestions(list), () => {});

  loadingHost.hidden = true;
  mainHost.hidden = false;
  actionsHost.hidden = false;
  mainHost.classList.add('fade-in');
  renderAll();
  const flash = takeFlash();
  if (flash) toast({ type: flash.type, message: flash.message });
  if (!bq) /** @type {HTMLElement | null} */ (editorHost.querySelector('.qcard__text'))?.focus();
}

// Rendering --------------------------------------------------------------------------

/** @param {string} title */
function setTitle(title) {
  titleEl.textContent = title;
  crumbEl.textContent = title;
  document.title = `${title} · Question Bank · JCI Uniben Quiz Admin`;
  const topbar = qs('.topbar__title');
  if (topbar) topbar.textContent = title;
}

function renderAll() {
  setTitle(saved ? 'Edit question' : 'New question');
  badgesHost.replaceChildren(...(saved ? [
    el('span', { class: 'badge bank-version-badge num' }, icon('bank', { size: 14 }), el('span', { text: `Version ${saved.version}` })),
    saved.status === 'archived'
      ? el('span', { class: 'badge badge--archived' }, icon('archive', { size: 14 }), el('span', { text: 'Archived' }))
      : null,
    el('span', { class: 'editor-head__detail', text: saved.usedInQuizCount ? `Used in ${plural(saved.usedInQuizCount, 'quiz', 'quizzes')}` : 'Not used in any quiz yet' })
  ].filter((node) => node !== null).map((node) => /** @type {HTMLElement} */ (node)) : [el('span', { class: 'editor-head__detail', text: 'Not saved yet' })]));

  /** @type {HTMLElement[]} */
  const banners = [];
  if (saved && saved.status === 'archived') {
    banners.push(el('div', { class: 'editor-banner editor-banner--info', data: { banner: 'archived' } },
      icon('archive', { size: 20, className: 'editor-banner__icon' }),
      el('div', { class: 'editor-banner__body' },
        el('p', { class: 'editor-banner__title', text: 'This question is archived' }),
        el('p', { text: 'It’s read-only and hidden from the quiz picker. Quizzes that use it keep their copy. Restore it to make changes.' })),
      el('div', { class: 'editor-banner__actions' },
        el('button', { type: 'button', class: 'btn btn--small btn--primary', on: { click: () => setStatus('restore') } }, el('span', { class: 'btn__label', text: 'Restore' })))));
  } else if (saved) {
    banners.push(el('div', { class: 'editor-banner editor-banner--info', data: { banner: 'versions' } },
      icon('info', { size: 20, className: 'editor-banner__icon' }),
      el('div', { class: 'editor-banner__body' },
        el('p', { class: 'editor-banner__title', text: 'Changes apply to future uses' }),
        el('p', { text: 'Quizzes that already use this question keep their own copy. Saving a change makes a new version, and those quizzes can review it and update when they choose.' }))));
  }
  bannersHost.replaceChildren(...banners);

  /** @type {[string, string][]} */
  const rows = saved ? [
    ['Version', formatNumber(saved.version)],
    ['Used in', saved.usedInQuizCount ? plural(saved.usedInQuizCount, 'quiz', 'quizzes') : 'No quizzes yet'],
    ['Created', formatDateTime(saved.createdAt)],
    ['Last updated', formatRelative(saved.updatedAt)]
  ] : [['Version', 'Saved as version 1'], ['Used in', 'No quizzes yet']];
  infoHost.replaceChildren(...rows.map(([term, value]) => el('div', { class: 'facts__row' }, el('dt', { text: term }), el('dd', { class: 'num', text: value }))));
  renderState();
  renderPreview();
}

/** Is anything on the page different from what's saved? */
function isDirty() {
  if (!current) return false;
  if (!saved) return true;
  return questionKey(current) !== questionKey(asQuestion(saved)) || JSON.stringify(tags) !== JSON.stringify(savedTags);
}

function renderState() {
  const archived = saved?.status === 'archived';
  const dirty = isDirty();
  saveButton.disabled = archived || saving || (Boolean(saved) && !dirty);
  saveButton.hidden = archived;
  stateEl.classList.toggle('is-dirty', dirty && !archived);
  stateEl.textContent = archived ? 'Read-only'
    : saving ? 'Saving…'
      : uploads.pending ? 'Image uploading…'
        : !saved ? 'Not saved yet'
          : dirty ? 'Unsaved changes'
            : `Saved · version ${saved.version}`;
}

function schedulePreview() {
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => { previewFrame = 0; renderPreview(); });
}

/** The question in the default look, as participants would see it. */
function renderPreview() {
  if (!current) return;
  loadFonts([resolveAppearance(DEFAULT_APPEARANCE, current.appearance).fontFamily]);
  const page = el('div', { class: 'appearance-sample__page' }, renderQuestion(current, DEFAULT_APPEARANCE, { showCorrect: true }));
  page.style.background = DEFAULT_APPEARANCE.pageBackground;
  previewHost.replaceChildren(page);
}

// Saving -----------------------------------------------------------------------------

async function save() {
  if (!current || saving || saved?.status === 'archived') return false;
  if (uploads.pending) {
    toast({ message: 'An image is still uploading. Save once it’s done.' });
    return false;
  }
  if (saved && !isDirty()) {
    toast({ message: 'Nothing to save. Everything is up to date.' });
    return true;
  }
  const errors = validateQuestion(current).filter((issue) => issue.level === 'error');
  if (errors.length || uploads.failed) {
    builder?.revealAll();
    const first = errors[0];
    if (first) builder?.focusQuestion(current.id, first.target);
    toast({ type: 'error', message: uploads.failed
      ? 'An image didn’t upload. Try again or remove it, then save.'
      : `Fix ${plural(errors.length, 'thing')} in the question first. ${first ? first.message : ''}` });
    return false;
  }
  if (tagInput && tagInput.input.value.trim()) {
    // A tag still being typed counts.
    tags = [...tags, tagInput.input.value.trim()];
    tagInput.input.value = '';
    tagInput.set(tags);
  }
  saving = true;
  setButtonLoading(saveButton, true);
  renderState();
  try {
    const before = saved?.version;
    const result = saved
      ? await api.updateBankQuestion(saved.id, current, { tags, version: saved.version })
      : await api.createBankQuestion(current, { tags });
    const wasNew = !saved;
    saved = result;
    savedTags = result.tags.slice();
    tags = result.tags.slice();
    tagInput?.set(tags);
    if (wasNew) {
      bankId = result.id;
      window.history.replaceState(null, '', `question-edit.html?id=${encodeURIComponent(result.id)}`);
      toast({ type: 'success', message: 'Saved to the Question Bank as version 1.' });
    } else if (before !== undefined && result.version > before) {
      toast({ type: 'success', message: `Saved as version ${result.version}. Quizzes using an earlier version keep their copy.` });
    } else {
      toast({ type: 'success', message: 'Saved.' });
    }
    announce(`Saved, version ${result.version}.`);
    return true;
  } catch (error) {
    return handleSaveError(error);
  } finally {
    saving = false;
    setButtonLoading(saveButton, false);
    renderAll();
  }
}

/** @param {unknown} error */
async function handleSaveError(error) {
  if (!(error instanceof ApiError)) {
    toast({ type: 'error', message: `Couldn’t save. ${userMessage(error)} Your changes are still here.` });
    return false;
  }
  if (error.status === 401) {
    const ok = await signInAgain({ identifier: admin?.email || '', reason: 'Your session ended while you were editing.' });
    if (ok) {
      saving = false;
      return save();
    }
    return false;
  }
  if (error.status === 409) {
    const choice = await openDialog({
      title: 'This question was changed somewhere else',
      body: ['Someone saved a newer version while you were editing. Nothing was overwritten, and your changes are still on this page.',
        'Load the latest version to see it (your changes here will be lost), or keep editing and copy what you need first.'],
      actions: [
        { label: 'Keep editing', value: 'keep', variant: 'ghost', autofocus: true },
        { label: 'Load the latest version', value: 'load', variant: 'danger' }
      ]
    });
    if (choice === 'load') {
      try {
        setup(await api.getBankQuestion(bankId));
        toast({ type: 'success', message: 'Loaded the latest version.' });
      } catch (loadError) {
        toast({ type: 'error', message: `Couldn’t load it. ${userMessage(loadError)}` });
      }
    }
    return false;
  }
  if (error.status === 404) {
    toast({ type: 'error', message: 'This question no longer exists in the bank. Copy anything you need before leaving.' });
    return false;
  }
  toast({ type: 'error', message: `Couldn’t save. ${userMessage(error)}${error.status >= 500 || error.kind !== 'http' ? ' Your changes are still here; try again.' : ''}` });
  return false;
}

saveButton.addEventListener('click', () => save());
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (current) save();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (current && saved?.status !== 'archived' && (isDirty() || uploads.pending) && !(saved === null && isPristineNew())) {
    event.preventDefault();
    event.returnValue = '';
  }
});

/** A brand-new question nobody has typed into yet isn't worth a warning. */
function isPristineNew() {
  return !current.text.trim() && !tags.length && (current.options || []).every((o) => !o.text.trim());
}

// More actions ------------------------------------------------------------------------

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
  if (!saved) {
    toast({ message: 'Save the question first. Then you can archive or delete it.' });
    return;
  }
  /** @type {import('../components/menu.js').MenuItem[]} */
  const items = [];
  if (saved.status === 'archived') items.push({ id: 'restore', label: 'Restore', icon: 'restore' });
  else items.push({ id: 'archive', label: 'Archive', icon: 'archive' });
  items.push({ id: 'delete', label: 'Delete…', icon: 'trash', tone: 'danger', separatorBefore: true });
  showMenu(moreButton, items, {
    label: 'More actions for this question',
    focus,
    onSelect: (id) => {
      if (id === 'archive' || id === 'restore') setStatus(id);
      if (id === 'delete') remove();
    }
  });
}

/** @param {'archive' | 'restore'} action */
async function setStatus(action) {
  if (!saved) return;
  if (action === 'archive' && isDirty()) {
    const choice = await openDialog({
      title: 'Save your changes first?',
      body: 'You have unsaved changes. Archived questions are read-only, so save them first or leave them out.',
      actions: [
        { label: 'Cancel', value: 'cancel', variant: 'ghost' },
        { label: 'Archive without saving', value: 'discard' },
        { label: 'Save, then archive', value: 'save', variant: 'primary', autofocus: true }
      ]
    });
    if (choice === 'cancel' || choice === null) return;
    if (choice === 'save' && !(await save())) return;
  }
  try {
    const result = action === 'archive' ? await api.archiveBankQuestion(saved.id) : await api.restoreBankQuestion(saved.id);
    setup(result);
    toast({ type: 'success', message: action === 'archive'
      ? 'Archived. It’s hidden from the quiz picker; quizzes that use it keep their copy.'
      : 'Restored. You can edit it again, and it’s back in the quiz picker.' });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { redirectToLogin(); return; }
    toast({ type: 'error', message: `Couldn’t ${action} it. ${userMessage(error)}` });
  }
}

async function remove() {
  if (!saved) return;
  if (saved.usedInQuizCount > 0) {
    const choice = await openDialog({
      title: 'This question can’t be deleted',
      body: [`It’s used in ${plural(saved.usedInQuizCount, 'quiz', 'quizzes')}. Archive it instead: it’s hidden from the picker and those quizzes keep working.`],
      actions: [
        { label: 'Cancel', value: 'cancel', variant: 'ghost' },
        ...(saved.status === 'archived' ? [] : [{ label: 'Archive instead', value: 'archive', variant: /** @type {const} */ ('primary'), autofocus: true }])
      ]
    });
    if (choice === 'archive') setStatus('archive');
    return;
  }
  const confirmed = await confirmDialog({
    title: 'Delete this question?',
    message: ['It will be removed from the Question Bank for good. No quiz uses it, so nothing else changes.'],
    confirmLabel: 'Delete question',
    tone: 'danger'
  });
  if (!confirmed) return;
  try {
    await api.deleteBankQuestion(saved.id);
    saved = null;
    current = /** @type {any} */ (null);
    setFlash({ type: 'success', message: 'Question deleted from the bank.' });
    window.location.href = 'question-bank.html';
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { redirectToLogin(); return; }
    toast({ type: 'error', message: `Couldn’t delete it. ${userMessage(error)}` });
  }
}
