// @ts-check
/**
 * The question builder (the Questions tab, section 14).
 * - Cards in order. One question is open for editing at a time; the others
 *   show a compact preview, so the list doubles as an overview.
 * - Add any of the four types, duplicate, delete (with Undo), change type
 *   (with a warning when something would be lost), and reorder by dragging
 *   the handle or with the Move up / Move down buttons (or Alt + ↑/↓).
 * - Validation messages appear once a field has been used, or for every field
 *   once the question is closed — never while a new question is still blank.
 * - Images upload straight away (with progress), separately from autosave.
 * The builder only edits a list of questions in memory and reports every
 * change through onChange; saving is the editor page's job.
 * All text is set with textContent, never as HTML.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { flip, prefersReducedMotion } from '../core/motion.js';
import { makeSortable } from '../core/sortable.js';
import { formatNumber, plural } from '../core/format.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/dialog.js';
import { showMenu, menuButtonAttrs } from '../components/menu.js';
import { QUESTION_TYPES, TYPE_ORDER, createQuestion, validateQuestion, convertQuestion } from './question-types.js';
import { LIMITS, MIN_OPTIONS, copyQuestion, moveItem, totalMarks, parseMarks, parseMaxLength } from './question-model.js';
import { createImageField } from './image-field.js';
import { issueSlot } from './question-ui.js';
import { renderQuestion } from './renderer.js';
import { createQuestionAppearance } from './appearance-panel.js';
import { sanitizeAppearance, hasOverrides, loadFonts, resolveAppearance } from './appearance.js';

/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../types.js').Option} Option */
/** @typedef {import('../types.js').QuizImage} QuizImage */
/** @typedef {import('../types.js').QuizSettings} QuizSettings */
/** @typedef {import('../types.js').QuestionType} QuestionType */
/** @typedef {import('./question-ui.js').TypeEditorContext} TypeEditorContext */
/** @typedef {ReturnType<typeof createImageField>} ImageField */
/** @typedef {null | 'locked' | 'archived'} ReadOnlyReason */

/**
 * @typedef {Object} BuilderOptions
 * @property {Question[]} questions
 * @property {QuizSettings} settings
 * @property {import('./appearance.js').Appearance} appearance   the quiz-wide look; cards are drawn in it
 * @property {ReadOnlyReason} readOnly                    locked (participants have started) or archived: preview only
 * @property {(questions: Question[]) => void} onChange
 * @property {import('./image-field.js').ImageFieldOptions['upload']} upload
 * @property {(uploads: { pending: number, failed: number }) => void} onUploadsChange
 * @property {(id: string) => boolean} [isSaved]          does the server have this question right now?
 * @property {string} [lockMessage]                     overrides the read-only note (e.g. for an archived bank question)
 * @property {'quiz' | 'single'} [mode]                   'single': one question, always open (the Question Bank editor)
 * @property {{
 *   onAdd: (at: number) => void,
 *   onSave: (question: Question) => void,
 *   onReview: (question: Question, editable: boolean) => void
 * }} [bank]                                               Question Bank hooks (quiz mode)
 */

const UNDO_MS = 6000;
const TYPE_ICON_SIZE = 16;

/**
 * @param {HTMLElement} host
 * @param {BuilderOptions} options
 */
export function createQuestionBuilder(host, options) {
  const { onChange, upload, onUploadsChange, isSaved = () => true, bank } = options;
  const single = options.mode === 'single';
  /** @type {Map<string, { version: number, status: string }>} latest bank versions, by bank question id */
  let bankInfo = new Map();
  let questions = options.questions.slice();
  let settings = options.settings;
  let quizAppearance = sanitizeAppearance(options.appearance);
  /** @type {Set<string>} questions whose Appearance panel is open */
  const appearanceOpen = new Set();
  /** @type {Map<string, ReturnType<typeof createQuestionAppearance>>} */
  const appearancePanels = new Map();
  /** @type {ReadOnlyReason} */
  let readOnly = options.readOnly;
  /** @type {string | null} */
  let openId = null;
  /** Questions whose every issue is shown (loaded from the server, or closed once). */
  let revealed = new Set(questions.map((q) => q.id));
  /** @type {Map<string, Set<string>>} fields used so far, per question */
  const touched = new Map();
  /** @type {Map<string, Record<string, string>>} typed values that aren't valid yet (marks, max length) */
  const localErrors = new Map();
  /** @type {Map<string, HTMLElement>} */
  const cards = new Map();
  /** @type {Set<string>} cards to rebuild on the next render */
  const stale = new Set();
  /** @type {Map<string, ImageField>} */
  const imageFields = new Map();
  /** @type {Set<string>} questions whose image area is showing even without an image */
  const imageOpen = new Set();
  /** @type {Map<string, { status: 'uploading' | 'failed', questionId: string }>} */
  const uploads = new Map();
  /** @type {string | null} */
  let freshId = null;
  let outlineFrame = 0;

  const editable = () => !readOnly;
  /** @param {string} id */
  const find = (id) => questions.find((q) => q.id === id);
  /** @param {string} id */
  const indexOf = (id) => questions.findIndex((q) => q.id === id);
  /** @param {string} key */
  const safeId = (key) => key.replace(/[^a-zA-Z0-9_-]/g, '-');

  // Layout ------------------------------------------------------------------------------

  const summary = el('p', { class: 'panel-lede num qb-summary' });
  const addButton = el('button', { type: 'button', class: 'btn btn--primary qb-add-button' },
    icon('plus', { size: 18 }), el('span', { class: 'btn__label', text: 'Add question' }), icon('chevronDown', { size: 16, className: 'qb-add-button__chevron' }));
  menuButtonAttrs(addButton);
  addButton.addEventListener('click', () => openAddMenu());
  addButton.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openAddMenu(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  });
  const lockNote = el('p', { class: 'qb-lock-note' });

  const outlineButton = el('button', { type: 'button', class: 'btn qb-outline-button', on: { click: () => openOutlineDrawer() } },
    icon('listOrdered', { size: 18 }), el('span', { class: 'btn__label', text: 'Outline' }));
  const head = el('div', { class: 'qb-head' },
    el('div', { class: 'qb-head__titles' }, el('h2', { class: 'panel-title', text: 'Questions' }), summary),
    el('div', { class: 'qb-head__actions' }, outlineButton, addButton));

  const outlineList = el('ol', { class: 'qb-outline__list' });
  const outline = el('nav', { class: 'qb-outline', attrs: { 'aria-label': 'Question outline' } },
    el('p', { class: 'qb-outline__title', attrs: { 'aria-hidden': 'true' }, text: 'Outline' }), outlineList);
  const list = el('ol', { class: 'qcards', attrs: { 'aria-label': 'Questions' } });
  const emptyHost = el('div', { class: 'qb-empty-host' });
  const quickAdd = el('div', { class: 'qb-quick' },
    el('p', { class: 'qb-quick__label', id: 'qb-quick-label', text: 'Add another question' }),
    el('div', { class: 'qb-quick__buttons', attrs: { role: 'group', 'aria-labelledby': 'qb-quick-label' } },
      TYPE_ORDER.map((type) => el('button', {
        type: 'button',
        class: 'btn btn--small qb-quick__button',
        on: { click: () => addQuestion(type, questions.length) }
      }, icon(QUESTION_TYPES[type].icon, { size: TYPE_ICON_SIZE }), el('span', { class: 'btn__label', text: QUESTION_TYPES[type].label }))),
      bank ? el('button', {
        type: 'button',
        class: 'btn btn--small qb-quick__button',
        data: { addFromBank: '' },
        on: { click: () => bank.onAdd(questions.length) }
      }, icon('bank', { size: TYPE_ICON_SIZE }), el('span', { class: 'btn__label', text: 'From Question Bank' })) : null));
  const main = el('div', { class: 'qb-main' }, lockNote, emptyHost, list, quickAdd);
  const root = el('div', { class: 'qb' }, head, el('div', { class: 'qb-layout' }, outline, main));
  host.replaceChildren(root);

  // Don't let a file dropped beside an image field open in the browser tab.
  root.addEventListener('dragover', (event) => { if (hasFiles(event)) event.preventDefault(); });
  root.addEventListener('drop', (event) => { if (hasFiles(event)) event.preventDefault(); });

  const cleanups = [
    makeSortable(list, { item: '.qcard', handle: '.qcard__grip', enabled: editable, onMove: (from, to) => moveQuestion(from, to, { via: 'drag' }) }),
    makeSortable(outlineList, {
      item: '.qb-outline__item',
      handle: '.qb-outline__grip',
      enabled: editable,
      onMove: (from, to, before) => {
        const id = questions[from].id;
        moveQuestion(from, to, { via: 'drag' });
        glideFrom(outlineList.querySelector(`[data-qid="${id}"]`), before);
      }
    })
  ];

  // Changes -----------------------------------------------------------------------------

  function emit() {
    onChange(questions);
    renderSummary();
    scheduleOutline();
  }

  /** @param {string} id @param {Partial<Question>} patch */
  function update(id, patch) {
    questions = questions.map((q) => (q.id === id ? { ...q, ...patch } : q));
    emit();
    paint(id);
  }

  /** @param {string} id @param {string} target */
  function touch(id, target) {
    if (!touched.has(id)) touched.set(id, new Set());
    /** @type {Set<string>} */ (touched.get(id)).add(target);
  }

  /** @param {string} id @param {string} field @param {string | null} message */
  function setLocalError(id, field, message) {
    const errors = { ...(localErrors.get(id) || {}) };
    if (message) errors[field] = message;
    else delete errors[field];
    if (Object.keys(errors).length) localErrors.set(id, errors);
    else localErrors.delete(id);
  }

  /**
   * @param {QuestionType} type
   * @param {number} [at]   position; defaults to just after the open question
   */
  function addQuestion(type, at) {
    if (!editable()) return;
    const question = createQuestion(type);
    if (type === 'short_answer') question.caseSensitive = Boolean(settings.shortAnswerCaseSensitive);
    const openIndex = openId ? indexOf(openId) : -1;
    const index = at ?? (openIndex >= 0 ? openIndex + 1 : questions.length);
    const next = questions.slice();
    next.splice(index, 0, question);
    questions = next;
    freshId = question.id;
    emit();
    setOpen(question.id, { focus: 'text', scroll: true });
    announce(`Question ${index + 1} added: ${QUESTION_TYPES[type].label}.`);
  }

  /** @param {string} id */
  function duplicateQuestion(id) {
    const index = indexOf(id);
    if (index < 0 || !editable()) return;
    const copy = copyQuestion(questions[index]);
    const next = questions.slice();
    next.splice(index + 1, 0, copy);
    questions = next;
    if (revealed.has(id)) revealed.add(copy.id);
    freshId = copy.id;
    emit();
    setOpen(copy.id, { focus: 'text', scroll: true });
    toast({ type: 'success', message: `Duplicated as question ${index + 2}.` });
  }

  /** @param {string} id */
  function deleteQuestion(id) {
    const index = indexOf(id);
    if (index < 0 || !editable()) return;
    const removed = questions[index];
    const node = cards.get(id);
    if (node?.classList.contains('is-leaving')) return;
    const finish = () => {
      questions = questions.filter((q) => q.id !== id);
      if (openId === id) openId = null;
      const others = [...cards.values()].filter((card) => card !== node);
      flip(others, () => renderList(), { duration: 280 });
      emit();
      prune();
      const focusTarget = questions[index] || questions[index - 1];
      if (focusTarget) /** @type {HTMLElement | null} */ (cards.get(focusTarget.id)?.querySelector('.qcard__toggle, .qcard__heading'))?.focus();
      else /** @type {HTMLElement | null} */ (emptyHost.querySelector('button'))?.focus();
      toast({
        message: `Question ${index + 1} deleted.`,
        duration: UNDO_MS,
        action: { label: 'Undo', onClick: () => restoreQuestion(removed, index) }
      });
    };
    if (node && !prefersReducedMotion()) {
      node.classList.add('is-leaving');
      node.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.98)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' })
        .finished.then(finish, finish);
    } else finish();
  }

  /** @param {Question} question @param {number} index */
  function restoreQuestion(question, index) {
    if (!editable() || find(question.id)) return;
    // If the server already deleted it, bring it back as a new question so
    // the backend never sees an id it has thrown away.
    const back = isSaved(question.id) ? question : { ...copyQuestion(question), source: question.source };
    const next = questions.slice();
    next.splice(Math.min(index, next.length), 0, back);
    questions = next;
    revealed.add(back.id);
    freshId = back.id;
    emit();
    setOpen(back.id, { focus: 'toggle', scroll: true });
    announce(`Question ${Math.min(index, questions.length - 1) + 1} restored.`);
  }

  /**
   * @param {number} from
   * @param {number} to
   * @param {{ via?: 'drag' | 'button' | 'keys', focus?: string }} [how]
   */
  function moveQuestion(from, to, { via = 'button', focus } = {}) {
    if (!editable() || to < 0 || to >= questions.length || from === to) return;
    const id = questions[from].id;
    questions = moveItem(questions, from, to);
    const nodes = [...cards.values()];
    if (via === 'drag') renderList();
    else flip(nodes, () => renderList(), { duration: 300 });
    emit();
    if (focus) {
      const card = cards.get(id);
      const target = /** @type {HTMLElement | null} */ (card?.querySelector(focus));
      if (target && !(/** @type {HTMLButtonElement} */ (target)).disabled) target.focus();
      else /** @type {HTMLElement | null} */ (card?.querySelector('.qcard__toggle'))?.focus();
    }
    announce(`Question ${from + 1} moved to position ${to + 1} of ${questions.length}.`);
  }

  /**
   * @param {string} id
   * @param {QuestionType} type
   */
  async function changeType(id, type) {
    const q = find(id);
    if (!q || q.type === type || !editable()) return;
    const { question, lost } = convertQuestion(q, type);
    if (lost.length) {
      const ok = await confirmDialog({
        title: `Change to ${QUESTION_TYPES[type].label.toLowerCase()}?`,
        message: [
          'Your question text, marks, image and explanation stay. This question will lose:',
          el('ul', { class: 'problem-list' }, lost.map((item) => el('li', {}, icon('alertTriangle', { size: 16 }), el('span', { text: item }))))
        ],
        confirmLabel: 'Change type',
        cancelLabel: `Keep ${QUESTION_TYPES[q.type].label.toLowerCase()}`
      });
      const card = cards.get(id);
      if (!ok) {
        const radio = /** @type {HTMLInputElement | null} */ (card?.querySelector(`input[name="q-${id}-type"][value="${q.type}"]`));
        if (radio) { radio.checked = true; radio.focus(); }
        return;
      }
    }
    questions = questions.map((item) => (item.id === id ? question : item));
    if (!QUESTION_TYPES[type].fields.includes('maxLength')) setLocalError(id, 'maxLength', null);
    stale.add(id);
    renderList();
    emit();
    prune();
    /** @type {HTMLElement | null} */ (cards.get(id)?.querySelector(`input[name="q-${id}-type"][value="${type}"]`))?.focus();
    announce(`Changed to ${QUESTION_TYPES[type].label}.`);
  }

  /**
   * Open one question for editing (or none). The question that was open is
   * closed and its issues are shown from now on.
   * @param {string | null} id
   * @param {{ focus?: 'text' | 'toggle' | null, scroll?: boolean }} [how]
   */
  function setOpen(id, { focus = null, scroll = false } = {}) {
    if (id && !editable()) return;
    const previous = openId;
    if (previous && previous !== id) {
      revealed.add(previous);
      stale.add(previous);
    }
    openId = id;
    if (id) stale.add(id);
    const nodes = [...cards.values()];
    flip(nodes, () => renderList(), { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    const card = id ? cards.get(id) : previous ? cards.get(previous) : null;
    if (!card) return;
    if (scroll) revealCard(card);
    if (focus === 'text') /** @type {HTMLElement | null} */ (card.querySelector('.qcard__text'))?.focus({ preventScroll: scroll });
    if (focus === 'toggle') /** @type {HTMLElement | null} */ (card.querySelector('.qcard__toggle'))?.focus({ preventScroll: scroll });
  }

  /** Close the open question and return focus to its heading. */
  function closeOpen() {
    const id = openId;
    if (!id) return;
    setOpen(null);
    /** @type {HTMLElement | null} */ (cards.get(id)?.querySelector('.qcard__toggle'))?.focus();
  }

  /** Destroy image fields whose question or option no longer exists. */
  function prune() {
    /** @type {Set<string>} */
    const keys = new Set();
    for (const q of questions) {
      keys.add(q.id);
      for (const option of q.options || []) keys.add(`${q.id}:${option.id}`);
    }
    for (const [key, field] of imageFields) {
      if (keys.has(key)) continue;
      field.destroy();
      imageFields.delete(key);
      uploads.delete(key);
    }
    for (const id of [...imageOpen]) if (!keys.has(id)) imageOpen.delete(id);
    for (const id of [...appearancePanels.keys()]) {
      if (keys.has(id)) continue;
      appearancePanels.delete(id);
      appearanceOpen.delete(id);
    }
    emitUploads();
  }

  // Images --------------------------------------------------------------------------------

  /** @param {string} key @param {string} questionId @param {'uploading' | 'failed' | 'idle'} status */
  function setUpload(key, questionId, status) {
    if (status === 'idle') uploads.delete(key);
    else uploads.set(key, { status, questionId });
    emitUploads();
    paintHead(questionId);
  }

  function emitUploads() {
    let pending = 0;
    let failed = 0;
    for (const { status } of uploads.values()) {
      if (status === 'uploading') pending += 1;
      else failed += 1;
    }
    onUploadsChange({ pending, failed });
  }

  /**
   * The image field for a question (key = question id) or an option
   * (key = "question:option"). Kept between renders so an upload in progress
   * survives the card being redrawn.
   * @param {string} questionId
   * @param {Option | null} option
   * @param {number} [optionIndex]
   */
  function imageField(questionId, option, optionIndex = 0) {
    const key = option ? `${questionId}:${option.id}` : questionId;
    let field = imageFields.get(key);
    if (field) return field;
    const q = /** @type {Question} */ (find(questionId));
    const image = option ? option.image : q.image;
    field = createImageField({
      id: `img-${safeId(key)}`,
      image,
      subject: option ? `option ${optionIndex + 1}` : 'this question',
      compact: Boolean(option),
      issue: revealed.has(questionId) && image && !image.decorative && !image.alt.trim() ? 'alt' : null,
      upload,
      onStatus: (status) => setUpload(key, questionId, status),
      onChange: (next, change) => {
        const current = find(questionId);
        if (!current) return;
        if (option) {
          update(questionId, { options: (current.options || []).map((o) => (o.id === option.id ? { ...o, image: next } : o)) });
          if (change !== 'details') {
            renderTypeArea(questionId, `[data-option-id="${option.id}"] .option-row__tool`);
          }
        } else {
          update(questionId, { image: next });
          if (change === 'remove') imageOpen.add(questionId);
          if (openId !== questionId && change !== 'details') {
            stale.add(questionId);
            renderList();
          }
        }
        if (change === 'upload') announce('Image uploaded. Now describe it in the alt text field, or mark it as decorative.');
        if (change === 'remove') announce('Image removed.');
      }
    });
    imageFields.set(key, field);
    return field;
  }

  /** @param {Question} q */
  function questionImageArea(q) {
    const field = imageFields.get(q.id);
    const showField = q.image || imageOpen.has(q.id) || uploads.has(q.id);
    if (showField) return imageField(q.id, null).element;
    return el('button', {
      type: 'button',
      class: 'btn btn--small btn--ghost qcard__add-image',
      on: {
        click: () => {
          imageOpen.add(q.id);
          const area = cards.get(q.id)?.querySelector('.qcard__image');
          const created = field || imageField(q.id, null);
          area?.replaceChildren(created.element);
          created.choose();
          /** @type {HTMLElement | null} */ (created.element.querySelector('button'))?.focus();
        }
      }
    }, icon('image', { size: 18 }), el('span', { class: 'btn__label', text: 'Add an image' }));
  }

  // Rendering -----------------------------------------------------------------------------

  function renderSummary() {
    const total = totalMarks(questions);
    const manual = questions.filter((q) => !QUESTION_TYPES[q.type]?.autoGraded(q)).length;
    const parts = [plural(questions.length, 'question'), `${plural(total, 'mark')} in total`];
    if (manual) parts.push(`${formatNumber(manual)} graded by hand`);
    summary.textContent = parts.join(' · ');
  }

  /** Render, then wire drag-to-reorder for the open card's options if it was rebuilt. */
  function renderList() {
    const before = openId ? cards.get(openId) : null;
    renderCards();
    const card = openId ? cards.get(openId) : null;
    if (card && openId && card !== before) wireOptions(card, openId);
  }

  /** Put the cards in order, rebuilding only the ones that changed. */
  function renderCards() {
    const ids = new Set(questions.map((q) => q.id));
    for (const [id, node] of cards) {
      if (ids.has(id)) continue;
      node.remove();
      cards.delete(id);
    }
    questions.forEach((q, index) => {
      let node = cards.get(q.id);
      if (!node || stale.has(q.id)) {
        const fresh = buildCard(q, index);
        if (node) node.replaceWith(fresh);
        node = fresh;
        cards.set(q.id, fresh);
      }
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
      numberCard(node, index);
    });
    stale.clear();
    for (const q of questions) paint(q.id);

    renderEmpty();
    renderSummary();
    renderOutline();
    root.classList.toggle('is-readonly', Boolean(readOnly));
    addButton.hidden = single || !editable() || !questions.length;
    quickAdd.hidden = single || !editable() || !questions.length;
    head.hidden = single;
    lockNote.hidden = !readOnly;
    lockNote.replaceChildren(...(readOnly ? [icon(readOnly === 'locked' ? 'lock' : 'archive', { size: 16 }),
      el('span', { text: options.lockMessage || (readOnly === 'locked'
        ? 'Read-only: participants have started this quiz, so its questions are locked. Duplicate the quiz to change them.'
        : 'Read-only: this quiz is archived. Restore it to change its questions.') })] : []));

    if (freshId) {
      const node = cards.get(freshId);
      freshId = null;
      if (node && !prefersReducedMotion()) {
        node.classList.remove('is-fresh');
        void node.offsetWidth;
        node.classList.add('is-fresh');
      }
    }
  }

  /** @param {HTMLElement} node @param {number} index */
  function numberCard(node, index) {
    node.querySelectorAll('[data-q-number]').forEach((number) => {
      if (number.textContent !== String(index + 1)) number.textContent = String(index + 1);
    });
    const up = /** @type {HTMLButtonElement | null} */ (node.querySelector('[data-act="up"]'));
    const down = /** @type {HTMLButtonElement | null} */ (node.querySelector('[data-act="down"]'));
    if (up) up.disabled = index === 0;
    if (down) down.disabled = index === questions.length - 1;
  }

  function renderEmpty() {
    if (questions.length) {
      emptyHost.replaceChildren();
      return;
    }
    emptyHost.replaceChildren(el('section', { class: 'card qb-empty', attrs: { 'aria-labelledby': 'qb-empty-title' } },
      el('span', { class: 'qb-empty__icon', attrs: { 'aria-hidden': 'true' } }, icon('quizzes', { size: 26 })),
      el('h3', { class: 'qb-empty__title', id: 'qb-empty-title', text: editable() ? 'Add your first question' : 'No questions' }),
      el('p', { class: 'qb-empty__text', text: editable()
        ? 'Pick a type to start. You can change it later, and drag questions into any order.'
        : 'This quiz has no questions.' }),
      editable() ? el('div', { class: 'qb-empty__types' }, TYPE_ORDER.map((type) => {
        const def = QUESTION_TYPES[type];
        return el('button', { type: 'button', class: 'type-card', on: { click: () => addQuestion(type, 0) } },
          el('span', { class: 'type-card__icon', attrs: { 'aria-hidden': 'true' } }, icon(def.icon, { size: 20 })),
          el('span', { class: 'type-card__text' },
            el('span', { class: 'type-card__label', text: def.label }),
            el('span', { class: 'type-card__summary', text: def.summary })));
      }), bank ? el('button', { type: 'button', class: 'type-card type-card--bank', data: { addFromBank: '' }, on: { click: () => bank.onAdd(0) } },
        el('span', { class: 'type-card__icon', attrs: { 'aria-hidden': 'true' } }, icon('bank', { size: 20 })),
        el('span', { class: 'type-card__text' },
          el('span', { class: 'type-card__label', text: 'From Question Bank' }),
          el('span', { class: 'type-card__summary', text: 'Reuse questions you’ve saved' }))) : null) : null));
  }

  function scheduleOutline() {
    if (outlineFrame) return;
    outlineFrame = requestAnimationFrame(() => { outlineFrame = 0; renderOutline(); });
  }

  function renderOutline() {
    outline.hidden = single || !questions.length;
    root.classList.toggle('has-outline', !single && questions.length > 0);
    outlineList.replaceChildren(...questions.map((q, index) => {
      const errors = issueCount(q);
      const excerpt = q.text.trim().replace(/\s+/g, ' ');
      return el('li', { class: ['qb-outline__item', q.id === openId ? 'is-current' : ''], data: { qid: q.id } },
        editable() ? el('span', { class: 'drag-handle qb-outline__grip', attrs: { 'aria-hidden': 'true', title: 'Drag to reorder' } }, icon('grip', { size: 14 })) : null,
        el('button', {
          type: 'button',
          class: 'qb-outline__link',
          attrs: { 'aria-current': q.id === openId ? 'true' : null },
          on: { click: () => jumpTo(q.id) }
        },
        el('span', { class: 'qb-outline__num num', text: String(index + 1) }),
        icon(QUESTION_TYPES[q.type]?.icon || 'quizzes', { size: 14, className: 'qb-outline__type' }),
        el('span', { class: ['qb-outline__text', excerpt ? '' : 'is-missing'], text: excerpt || 'No text yet' }),
        el('span', { class: 'sr-only', text: `, ${QUESTION_TYPES[q.type]?.label || 'Question'}, ${plural(q.marks, 'mark')}${hasOverrides(q.appearance) ? ', custom style' : ''}${errors ? `, ${plural(errors, 'issue')} to fix` : ''}` }),
        hasOverrides(q.appearance) ? el('span', { class: 'qb-outline__custom', attrs: { 'aria-hidden': 'true', title: 'Custom style' } }, icon('palette', { size: 13 })) : null,
        errors ? el('span', { class: 'qb-outline__dot', attrs: { 'aria-hidden': 'true' } }) : null));
    }));
  }

  /** @param {string} id */
  function jumpTo(id) {
    if (editable()) {
      setOpen(id, { focus: 'text', scroll: true });
      return;
    }
    const card = cards.get(id);
    if (!card) return;
    revealCard(card, { always: true });
    highlight(card);
    /** @type {HTMLElement | null} */ (card.querySelector('.qcard__heading'))?.focus({ preventScroll: true });
  }

  /** @param {HTMLElement} card */
  function highlight(card) {
    card.classList.remove('is-highlighted');
    void card.offsetWidth;
    card.classList.add('is-highlighted');
  }

  /** Errors to fix, counting unfinished marks or length fields. @param {Question} q */
  function issueCount(q) {
    if (!revealed.has(q.id)) return 0;
    const local = Object.keys(localErrors.get(q.id) || {}).length;
    const failed = [...uploads.values()].filter((u) => u.questionId === q.id && u.status === 'failed').length;
    return validateQuestion(q).filter((issue) => issue.level === 'error').length + local + failed;
  }

  /**
   * @param {Question} q
   * @param {number} index
   */
  function buildCard(q, index) {
    const def = QUESTION_TYPES[q.type];
    const open = q.id === openId && editable();
    const bodyId = `q-${q.id}-body`;
    const excerpt = q.text.trim().replace(/\s+/g, ' ');

    const number = el('span', { class: 'qcard__num num', attrs: { 'aria-hidden': 'true' } }, el('span', { data: { qNumber: '' }, text: String(index + 1) }));
    const titleParts = [
      el('span', { class: 'sr-only' }, 'Question ', el('span', { data: { qNumber: '' }, text: String(index + 1) }), ': '),
      el('span', { class: ['qcard__excerpt', excerpt ? '' : 'is-missing'], text: excerpt || 'No question text yet' }),
      el('span', { class: 'qcard__meta' },
        icon(def.icon, { size: 14 }),
        el('span', { text: `${def.label} · ${plural(q.marks, 'mark')}` }),
        hasOverrides(q.appearance) ? el('span', { class: 'qcard__custom' }, icon('palette', { size: 13 }), el('span', { text: 'Custom style' })) : null,
        sourceBadge(q)),
      el('span', { class: 'qcard__issues', hidden: true })
    ];

    const heading = single
      ? el('h2', { class: 'qcard__heading qcard__heading--single', id: `q-${q.id}-toggle` }, el('span', { class: 'qcard__title' }, titleParts.slice(2)))
      : editable()
      ? el('h3', { class: 'qcard__heading' },
        el('button', {
          type: 'button',
          class: 'qcard__toggle',
          id: `q-${q.id}-toggle`,
          attrs: { 'aria-expanded': String(open), 'aria-controls': open ? bodyId : null },
          on: { click: () => (open ? closeOpen() : setOpen(q.id, { focus: 'text' })) }
        }, number, el('span', { class: 'qcard__title' }, titleParts), icon('chevronDown', { size: 18, className: 'qcard__chevron' })))
      : el('h3', { class: 'qcard__heading', attrs: { tabindex: '-1' } }, number, el('span', { class: 'qcard__title' }, titleParts));

    // Alt + ↑/↓ on a question's heading moves it, like options.
    heading.querySelector('.qcard__toggle')?.addEventListener('keydown', (event) => {
      const key = /** @type {KeyboardEvent} */ (event);
      if (!key.altKey || (key.key !== 'ArrowUp' && key.key !== 'ArrowDown')) return;
      key.preventDefault();
      const at = indexOf(q.id);
      moveQuestion(at, at + (key.key === 'ArrowUp' ? -1 : 1), { via: 'keys', focus: '.qcard__toggle' });
    });

    const top = el('div', { class: 'qcard__top' },
      editable() && !single ? el('span', { class: 'drag-handle qcard__grip', attrs: { 'aria-hidden': 'true', title: 'Drag to reorder' } }, icon('grip', { size: 18 })) : null,
      heading);

    const card = el('li', { class: ['qcard', open ? 'is-open' : ''], id: `q-${q.id}`, data: { qid: q.id } }, top);

    if (open) {
      const fold = el('div', { class: 'qcard__fold', id: bodyId, attrs: { role: 'group', 'aria-labelledby': `q-${q.id}-toggle` } },
        el('div', { class: 'qcard__inner' }, buildEditor(q)));
      card.append(fold);
      if (!prefersReducedMotion()) {
        fold.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
      wireCard(card, q.id);
    } else {
      // Drawn exactly as participants see it, in the quiz's own colours and fonts.
      loadFonts([resolveAppearance(quizAppearance, q.appearance).fontFamily]);
      const canvas = el('div', { class: 'qcard__canvas' }, renderQuestion(q, quizAppearance, { showMeta: false, showCorrect: true }));
      canvas.style.background = quizAppearance.pageBackground;
      const preview = el('div', { class: 'qcard__preview' }, canvas, readOnly ? readOnlyExtras(q) : null);
      if (editable()) preview.addEventListener('click', () => setOpen(q.id, { focus: 'text' }));
      card.append(preview);
    }
    return card;
  }

  /** The newer bank version number, if the bank has moved on. @param {Question} q */
  function newerVersion(q) {
    if (!q.source) return 0;
    const info = bankInfo.get(q.source.bankQuestionId);
    return info && info.version > q.source.bankVersion ? info.version : 0;
  }

  /** "From Question Bank · v3" (+ "Newer version") on a card's heading. @param {Question} q */
  function sourceBadge(q) {
    if (!q.source) return null;
    const newer = newerVersion(q);
    return el('span', { class: ['qcard__source', newer ? 'has-newer' : ''] },
      icon('bank', { size: 13 }),
      el('span', { text: `From Question Bank · v${q.source.bankVersion}` }),
      newer ? el('span', { class: 'qcard__source-newer', text: ' · newer version available' }) : null);
  }

  /** The bar at the top of an open question that came from the bank. @param {Question} q */
  function sourceBar(q) {
    const holder = el('div', { class: 'qcard__sourcebar-slot', data: { sourceFor: q.id } });
    fillSourceBar(holder, q);
    return holder;
  }

  /** @param {HTMLElement} holder @param {Question} q */
  function fillSourceBar(holder, q) {
    if (!q.source || single) {
      holder.replaceChildren();
      return;
    }
    const info = bankInfo.get(q.source.bankQuestionId);
    const newer = newerVersion(q);
    holder.replaceChildren(el('div', { class: ['qcard__sourcebar', newer ? 'has-newer' : ''] },
      icon('bank', { size: 16 }),
      el('p', { class: 'qcard__sourcebar-text' },
        el('strong', { text: `From Question Bank · v${q.source.bankVersion}` }),
        el('span', { text: newer
          ? ` A newer version (v${newer}) is in the bank. This quiz keeps its own copy until you update it.`
          : info?.status === 'archived' ? ' The bank question has since been archived. This copy is unaffected.'
            : ' This quiz has its own copy, so changes in the bank don’t affect it.' })),
      newer && bank ? el('button', { type: 'button', class: 'btn btn--small', data: { reviewUpdate: '' }, on: { click: () => bank.onReview(/** @type {Question} */ (find(q.id)), editable()) } },
        el('span', { class: 'btn__label', text: 'Review update' })) : null));
  }

  /** What a read-only card shows beyond the preview. @param {Question} q */
  function readOnlyExtras(q) {
    const extras = [readOnlyFacts(q), newerVersion(q) && bank
      ? el('div', { class: 'qcard__compare' },
        el('span', { class: 'qcard__newer' }, icon('info', { size: 14 }), el('span', { text: `Newer version available (v${newerVersion(q)})` })),
        el('button', { type: 'button', class: 'btn btn--small', data: { reviewUpdate: '' }, on: { click: (/** @type {Event} */ e) => { e.stopPropagation(); bank.onReview(q, false); } } },
          el('span', { class: 'btn__label', text: 'Compare versions' })))
      : null].filter(Boolean);
    return extras.length ? el('div', { class: 'qcard__extras-wrap' }, extras) : null;
  }

  /** @param {Question} q */
  function readOnlyFacts(q) {
    const rows = [];
    if (q.explanation) rows.push(['Explanation', q.explanation]);
    if (q.type === 'paragraph' && q.gradingNotes) rows.push(['Grading notes', q.gradingNotes]);
    if (q.maxLength) rows.push(['Maximum length', `${formatNumber(q.maxLength)} characters`]);
    if (!rows.length) return null;
    return el('dl', { class: 'qcard__extras' }, rows.map(([term, value]) =>
      el('div', {}, el('dt', { text: term }), el('dd', { text: value }))));
  }

  /**
   * The editing controls for the open question.
   * @param {Question} q
   */
  function buildEditor(q) {
    const id = q.id;
    const def = QUESTION_TYPES[q.type];

    // Type ---------------------------------------------------------------
    const typePicker = el('fieldset', { class: 'type-picker' },
      el('legend', { class: 'field__label', text: 'Question type' }),
      el('div', { class: 'type-picker__options' }, TYPE_ORDER.map((type) => {
        const input = el('input', { type: 'radio', name: `q-${id}-type`, value: type, checked: type === q.type });
        input.addEventListener('change', () => { if (input.checked) changeType(id, type); });
        return el('label', { class: 'type-picker__option' }, input,
          el('span', { class: 'type-picker__chip' }, icon(QUESTION_TYPES[type].icon, { size: TYPE_ICON_SIZE }), el('span', { text: QUESTION_TYPES[type].label })));
      })));

    // Text -----------------------------------------------------------------
    const textId = `q-${id}-text`;
    const counter = el('span', { class: 'char-count num', attrs: { 'aria-hidden': 'true' } });
    const text = el('textarea', {
      class: 'input input--area qcard__text',
      id: textId,
      rows: 2,
      value: q.text,
      maxLength: LIMITS.text,
      attrs: { placeholder: 'Type the question', 'aria-describedby': `${textId}-hint` }
    });
    const syncCounter = () => {
      const length = text.value.length;
      counter.textContent = length > LIMITS.text * 0.8 ? `${formatNumber(length)} / ${formatNumber(LIMITS.text)}` : '';
      counter.classList.toggle('is-near', length > LIMITS.text * 0.9);
    };
    text.addEventListener('input', () => { update(id, { text: text.value }); syncCounter(); });
    syncCounter();

    // Marks ----------------------------------------------------------------
    const marksId = `q-${id}-marks`;
    const marks = el('input', {
      class: 'input qcard__marks-input num',
      id: marksId,
      type: 'text',
      value: String(q.marks),
      attrs: { inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': `${marksId}-note` }
    });
    marks.addEventListener('input', () => {
      const parsed = parseMarks(marks.value);
      if ('value' in parsed) {
        setLocalError(id, 'marks', null);
        update(id, { marks: parsed.value });
      } else {
        setLocalError(id, 'marks', parsed.error);
        paint(id);
      }
    });
    marks.addEventListener('change', () => {
      if (!localErrors.get(id)?.marks) return;
      const kept = /** @type {Question} */ (find(id)).marks;
      marks.value = String(kept);
      setLocalError(id, 'marks', null);
      paint(id);
      announce(`Marks kept at ${formatNumber(kept)}.`);
    });

    // More options ---------------------------------------------------------
    const explanationId = `q-${id}-explanation`;
    const explanation = el('textarea', {
      class: 'input input--area',
      id: explanationId,
      rows: 2,
      value: q.explanation || '',
      maxLength: LIMITS.explanation,
      attrs: { 'aria-describedby': `${explanationId}-hint` }
    });
    explanation.addEventListener('input', () => update(id, { explanation: explanation.value.trim() ? explanation.value : null }));

    const hasLength = def.fields.includes('maxLength');
    const lengthId = `q-${id}-maxlength`;
    const maxLength = hasLength ? el('input', {
      class: 'input qcard__length-input num',
      id: lengthId,
      type: 'text',
      value: q.maxLength ? String(q.maxLength) : '',
      attrs: { inputmode: 'numeric', autocomplete: 'off', placeholder: 'No limit', 'aria-describedby': `${lengthId}-hint` }
    }) : null;
    if (maxLength) {
      maxLength.addEventListener('input', () => {
        const parsed = parseMaxLength(maxLength.value);
        if ('value' in parsed) {
          setLocalError(id, 'maxLength', null);
          update(id, { maxLength: parsed.value });
        } else {
          setLocalError(id, 'maxLength', parsed.error);
          paint(id);
        }
      });
      maxLength.addEventListener('change', () => {
        if (!localErrors.get(id)?.maxLength) return;
        const kept = /** @type {Question} */ (find(id)).maxLength;
        maxLength.value = kept ? String(kept) : '';
        setLocalError(id, 'maxLength', null);
        paint(id);
        announce(kept ? `Maximum length kept at ${formatNumber(kept)} characters.` : 'No maximum length.');
      });
    }

    const more = el('details', { class: 'qcard__more', open: Boolean(q.explanation || q.maxLength) },
      el('summary', { class: 'qcard__more-summary' }, icon('chevronRight', { size: 16, className: 'qcard__more-chevron' }), el('span', { text: 'More options' }),
        el('span', { class: 'qcard__more-hint', text: hasLength ? 'Explanation, answer length' : 'Explanation' })),
      el('div', { class: 'qcard__more-body' },
        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: explanationId, text: 'Explanation (optional)' }),
          explanation,
          el('p', { class: 'field__hint', id: `${explanationId}-hint`, text: 'Shown to participants with their results, if you choose to show correct answers (Settings).' })),
        maxLength ? el('div', { class: 'field' },
          el('label', { class: 'field__label', for: lengthId, text: 'Maximum answer length' }),
          el('div', { class: 'qcard__inline' }, maxLength, el('span', { class: 'qcard__unit', text: 'characters' })),
          el('p', { class: 'field__hint', id: `${lengthId}-hint`, text: 'Leave empty for no limit.' }),
          issueSlot('maxLength')) : null));

    // Toolbar --------------------------------------------------------------
    /** @param {string} act @param {string} iconName @param {string} label @param {() => void} run @param {string} [extra] */
    const tool = (act, iconName, label, run, extra = '') => el('button', {
      type: 'button',
      class: ['btn', 'btn--small', 'btn--ghost', extra],
      data: { act },
      on: { click: run }
    }, icon(iconName, { size: 16 }), el('span', { class: 'btn__label', text: label }));
    const at = () => indexOf(id);
    const toolbar = single
      ? el('div', { class: 'qcard__footer' },
        el('div', { class: 'qcard__tools', attrs: { role: 'group', 'aria-label': 'Question actions' } },
          tool('appearance', 'palette', 'Appearance', () => toggleAppearance(id))))
      : el('div', { class: 'qcard__footer' },
        el('div', { class: 'qcard__tools', attrs: { role: 'group', 'aria-label': 'Question actions' } },
          tool('duplicate', 'copy', 'Duplicate', () => duplicateQuestion(id)),
          tool('up', 'arrowUp', 'Move up', () => moveQuestion(at(), at() - 1, { focus: '[data-act="up"]' })),
          tool('down', 'arrowDown', 'Move down', () => moveQuestion(at(), at() + 1, { focus: '[data-act="down"]' })),
          tool('appearance', 'palette', 'Appearance', () => toggleAppearance(id)),
          bank ? tool('bank', 'bank', 'Save to bank', () => bank.onSave(/** @type {Question} */ (find(id)))) : null,
          tool('delete', 'trash', 'Delete', () => deleteQuestion(id), 'qcard__delete')),
        el('button', { type: 'button', class: 'btn btn--small qcard__done', on: { click: closeOpen } },
          icon('check', { size: 16 }), el('span', { class: 'btn__label', text: 'Done' })));
    const appearanceButton = /** @type {HTMLElement} */ (toolbar.querySelector('[data-act="appearance"]'));
    appearanceButton.setAttribute('aria-expanded', String(appearanceOpen.has(id)));
    appearanceButton.setAttribute('aria-controls', `q-${id}-appearance`);

    return el('div', { class: 'qcard__editor' },
      sourceBar(q),
      typePicker,
      el('div', { class: 'field' },
        el('div', { class: 'field__row' }, el('label', { class: 'field__label', for: textId, text: 'Question' }), counter),
        text,
        el('p', { class: 'field__hint', id: `${textId}-hint`, text: 'Shown to participants exactly as written. Line breaks are kept.' }),
        issueSlot('text')),
      el('div', { class: 'qcard__image' }, questionImageArea(q)),
      el('div', { class: 'qcard__type' }, def.editor(typeContext(id))),
      el('div', { class: 'qcard__marks' },
        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: marksId, text: 'Marks' }),
          el('div', { class: 'qcard__inline' }, marks, el('span', { class: 'qcard__unit', text: 'marks' })),
          issueSlot('marks')),
        el('p', { class: 'grading-note', id: `${marksId}-note`, data: { gradingNote: '' } },
          icon('info', { size: 16 }), el('span', { text: def.gradingNote(q, settings) }))),
      more,
      appearanceArea(id),
      toolbar);
  }

  /**
   * The question's Appearance panel (built on first use, kept while the card is open).
   * @param {string} id
   */
  function appearanceArea(id) {
    const area = el('div', { class: 'qcard__appearance', id: `q-${id}-appearance`, hidden: !appearanceOpen.has(id) });
    if (appearanceOpen.has(id)) area.append(appearancePanel(id).element);
    return area;
  }

  /** @param {string} id */
  function appearancePanel(id) {
    let panel = appearancePanels.get(id);
    if (!panel) {
      panel = createQuestionAppearance({
        id: `qa-${safeId(id)}`,
        question: () => /** @type {any} */ (find(id)),
        quizAppearance: () => quizAppearance,
        onChange: (overrides) => {
          update(id, { appearance: overrides });
          appearancePanels.get(id)?.refresh();
          const custom = hasOverrides(overrides);
          const meta = cards.get(id)?.querySelector('.qcard__meta');
          meta?.querySelector('.qcard__custom')?.remove();
          if (custom) meta?.append(el('span', { class: 'qcard__custom' }, icon('palette', { size: 13 }), el('span', { text: 'Custom style' })));
        }
      });
      appearancePanels.set(id, panel);
    } else panel.refresh();
    return panel;
  }

  /** Open or close the Appearance panel of the open question. @param {string} id */
  function toggleAppearance(id) {
    const card = cards.get(id);
    const area = /** @type {HTMLElement | null | undefined} */ (card?.querySelector('.qcard__appearance'));
    const button = card?.querySelector('[data-act="appearance"]');
    if (!area || !button) return;
    const open = area.hidden;
    if (open) {
      appearanceOpen.add(id);
      area.replaceChildren(appearancePanel(id).element);
      area.hidden = false;
      /** @type {HTMLElement | null} */ (area.querySelector('select, input, button'))?.focus();
      if (!prefersReducedMotion()) area.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    } else {
      appearanceOpen.delete(id);
      area.hidden = true;
      /** @type {HTMLElement} */ (button).focus();
    }
    button.setAttribute('aria-expanded', String(open));
  }

  /** The outline in a drawer, for screens too narrow to show it beside the cards. */
  function openOutlineDrawer() {
    const dialog = el('dialog', { class: 'dialog dialog--drawer qb-drawer', attrs: { 'aria-labelledby': 'qb-drawer-title' } });
    const close = () => dialog.close();
    const items = questions.map((q, index) => {
      const excerpt = q.text.trim().replace(/\s+/g, ' ');
      const errors = issueCount(q);
      return el('li', {},
        el('button', {
          type: 'button',
          class: ['qb-drawer__item', q.id === openId ? 'is-current' : ''],
          attrs: { 'aria-current': q.id === openId ? 'true' : null },
          on: { click: () => { close(); requestAnimationFrame(() => jumpTo(q.id)); } }
        },
        el('span', { class: 'qb-outline__num num', text: String(index + 1) }),
        icon(QUESTION_TYPES[q.type]?.icon || 'quizzes', { size: 16, className: 'qb-outline__type' }),
        el('span', { class: 'qb-drawer__text' },
          el('span', { class: ['qb-outline__text', excerpt ? '' : 'is-missing'], text: excerpt || 'No text yet' }),
          el('span', { class: 'qb-drawer__meta', text: `${QUESTION_TYPES[q.type]?.label || 'Question'} · ${plural(q.marks, 'mark')}${hasOverrides(q.appearance) ? ' · Custom style' : ''}` })),
        errors ? el('span', { class: 'qb-drawer__issues', text: `${formatNumber(errors)} to fix` }) : null));
    });
    dialog.append(el('div', { class: 'dialog__panel' },
      el('div', { class: 'dialog__header qb-drawer__head' },
        el('h2', { id: 'qb-drawer-title', text: 'Outline' }),
        el('button', { type: 'button', class: 'btn btn--ghost btn--icon', attrs: { 'aria-label': 'Close outline' }, on: { click: close } }, icon('close', { size: 20 }))),
      el('p', { class: 'qb-drawer__summary num', text: summary.textContent || '' }),
      el('ol', { class: 'qb-drawer__list' }, items)));
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    dialog.addEventListener('close', () => {
      window.setTimeout(() => dialog.remove(), 400);
      if (outlineButton.isConnected && !document.activeElement?.closest('.qcard')) outlineButton.focus({ preventScroll: true });
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    /** @type {HTMLElement | null} */ (dialog.querySelector('.qb-drawer__item.is-current, .qb-drawer__item'))?.focus();
  }

  /** Listeners on an open card: Esc closes it, leaving a field shows its issues, files can be dropped. */
  /** @param {HTMLElement} card @param {string} id */
  function wireCard(card, id) {
    card.addEventListener('keydown', (event) => {
      if (single || event.key !== 'Escape' || event.defaultPrevented || openId !== id) return;
      if (/** @type {HTMLElement} */ (event.target).closest('dialog, .menu')) return;
      event.preventDefault();
      closeOpen();
    });
    card.addEventListener('focusout', (event) => {
      const target = targetFor(/** @type {HTMLElement} */ (event.target), id);
      if (!target) return;
      touch(id, target);
      paint(id);
    });
    card.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      card.classList.add('is-file-over');
    });
    card.addEventListener('dragleave', (event) => {
      if (!card.contains(/** @type {Node | null} */ (event.relatedTarget))) card.classList.remove('is-file-over');
    });
    card.addEventListener('drop', (event) => {
      card.classList.remove('is-file-over');
      const file = event.dataTransfer?.files?.[0];
      if (!file || event.defaultPrevented) return;   // an image field took it
      event.preventDefault();
      imageOpen.add(id);
      const field = imageField(id, null);
      card.querySelector('.qcard__image')?.replaceChildren(field.element);
      field.accept(file);
    });
  }

  /** Which issue target a control belongs to. @param {HTMLElement} node @param {string} id */
  function targetFor(node, id) {
    if (node.id === `q-${id}-text`) return 'text';
    if (node.id === `q-${id}-marks`) return 'marks';
    if (node.id === `q-${id}-maxlength`) return 'maxLength';
    if (node.id === `q-${id}-accepted`) return 'accepted';
    const row = /** @type {HTMLElement | null} */ (node.closest('[data-option-id]'));
    if (row && node.classList.contains('option-row__text')) return `option:${row.dataset.optionId}`;
    return null;
  }

  /** The control an issue is about, to focus it and mark it invalid. @param {HTMLElement} card @param {string} id @param {string} target */
  function controlFor(card, id, target) {
    if (target === 'text' || target === 'marks' || target === 'accepted') return /** @type {HTMLElement | null} */ (card.querySelector(`#q-${id}-${target}`));
    if (target === 'maxLength') return /** @type {HTMLElement | null} */ (card.querySelector(`#q-${id}-maxlength`));
    if (target === 'options' || target === 'correct') return /** @type {HTMLElement | null} */ (card.querySelector(`#q-${id}-options`));
    if (target === 'image') return /** @type {HTMLElement | null} */ (card.querySelector(`#img-${safeId(id)}-alt`));
    if (target.startsWith('option:')) return /** @type {HTMLElement | null} */ (card.querySelector(`[data-option-id="${target.slice(7)}"] .option-row__text`));
    if (target.startsWith('option-image:')) return /** @type {HTMLElement | null} */ (card.querySelector(`#img-${safeId(`${id}:${target.slice(13)}`)}-alt`));
    return null;
  }

  /** Update the issue count on a card's heading. @param {string} id */
  function paintHead(id) {
    const q = find(id);
    const pill = /** @type {HTMLElement | null | undefined} */ (cards.get(id)?.querySelector('.qcard__issues'));
    if (!q || !pill) return;
    const count = id === openId ? 0 : issueCount(q);
    pill.hidden = !count;
    pill.textContent = count ? `${formatNumber(count)} to fix` : '';
    cards.get(id)?.classList.toggle('has-issues', count > 0);
  }

  /**
   * Show the current messages in the open card's issue slots (only those that
   * changed), mark the related controls invalid, and refresh the grading note.
   * @param {string} id
   */
  function paint(id) {
    paintHead(id);
    const q = find(id);
    const card = cards.get(id);
    if (!q || !card || id !== openId) return;
    const issues = validateQuestion(q);
    const local = localErrors.get(id) || {};
    const used = touched.get(id) || new Set();
    const shown = (/** @type {import('./question-ui.js').QuestionIssue} */ issue) =>
      issue.level === 'warning' || revealed.has(id) || used.has(issue.target);

    card.querySelectorAll('[data-issue-for]').forEach((node) => {
      const slotEl = /** @type {HTMLElement} */ (node);
      const target = /** @type {string} */ (slotEl.dataset.issueFor);
      /** @type {{ message: string, level: 'error' | 'warning' }[]} */
      const messages = local[target]
        ? [{ message: local[target], level: 'error' }]
        : issues.filter((issue) => issue.target === target && shown(issue)).map(({ message, level }) => ({ message, level }));
      const key = messages.map((m) => `${m.level}:${m.message}`).join('|');
      if (slotEl.dataset.key === key) return;
      slotEl.dataset.key = key;
      if (!slotEl.id) {
        slotEl.id = `q-${id}-issue-${safeId(target)}`;
        slotEl.setAttribute('aria-live', 'polite');
      }
      slotEl.replaceChildren(...messages.map((m) => el('p', { class: ['q-issue', m.level === 'warning' ? 'q-issue--warning' : ''] },
        icon(m.level === 'warning' ? 'alertTriangle' : 'alertCircle', { size: 14 }), el('span', { text: m.message }))));
      const control = controlFor(card, id, target);
      if (control) {
        const invalid = messages.some((m) => m.level === 'error');
        if (invalid) control.setAttribute('aria-invalid', 'true');
        else control.removeAttribute('aria-invalid');
        const described = new Set((control.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
        if (messages.length) described.add(slotEl.id);
        else described.delete(slotEl.id);
        if (described.size) control.setAttribute('aria-describedby', [...described].join(' '));
        else control.removeAttribute('aria-describedby');
      }
    });
    const note = card.querySelector('[data-grading-note] span');
    if (note) note.textContent = QUESTION_TYPES[q.type].gradingNote(q, settings);
  }

  /**
   * Redraw just the type-specific part of the open card (options, accepted
   * answers…), then put focus back where it belongs.
   * @param {string} id
   * @param {string} [focus]   selector inside the card
   */
  function renderTypeArea(id, focus) {
    const q = find(id);
    const card = cards.get(id);
    const area = card?.querySelector('.qcard__type');
    if (!q || !card || !area || id !== openId) {
      if (q && card) {
        stale.add(id);   // e.g. an upload finished after the card was closed
        renderList();
      }
      return;
    }
    area.replaceChildren(QUESTION_TYPES[q.type].editor(typeContext(id)));
    wireOptions(card, id);
    paint(id);
    if (focus) /** @type {HTMLElement | null} */ (card.querySelector(focus))?.focus();
  }

  /** Drag-to-reorder for the open question's options. @param {HTMLElement} card @param {string} id */
  function wireOptions(card, id) {
    const optionList = /** @type {HTMLElement | null} */ (card.querySelector('.options'));
    if (!optionList) return;
    makeSortable(optionList, {
      item: '.option-row',
      handle: '.option-row__grip',
      enabled: editable,
      onMove: (from, to, before) => {
        const q = find(id);
        if (!q?.options) return;
        const optionId = q.options[from].id;
        update(id, { options: moveItem(q.options, from, to) });
        renderTypeArea(id);
        glideFrom(card.querySelector(`[data-option-id="${optionId}"]`), before);
        announce(`Option ${from + 1} moved to position ${to + 1}.`);
      }
    });
  }

  /**
   * The context a type's editor works through (see question-ui.js).
   * @param {string} id
   * @returns {TypeEditorContext}
   */
  function typeContext(id) {
    return {
      get: () => /** @type {Question} */ (find(id)),
      change: (patch, { rerender = false, focus } = {}) => {
        update(id, patch);
        if (rerender) renderTypeArea(id, focus);
      },
      removeOption: (index) => {
        const q = find(id);
        const current = q?.options || [];
        if (!q || current.length <= MIN_OPTIONS) return;
        const removed = current[index];
        const after = current.filter((_, i) => i !== index);
        const neighbour = after[Math.min(index, after.length - 1)];
        update(id, { options: after });
        renderTypeArea(id, neighbour ? `[data-option-id="${neighbour.id}"] .option-row__text` : undefined);
        prune();
        toast({
          message: `Option ${index + 1} removed.`,
          duration: UNDO_MS,
          action: {
            label: 'Undo',
            onClick: () => {
              const now = find(id);
              if (!now?.options || now.options.some((o) => o.id === removed.id)) return;
              const restored = now.options.slice();
              restored.splice(Math.min(index, restored.length), 0, removed);
              update(id, { options: restored });
              if (openId === id) renderTypeArea(id, `[data-option-id="${removed.id}"] .option-row__text`);
              else { stale.add(id); renderList(); }
              announce(`Option ${index + 1} restored.`);
            }
          }
        });
      },
      announce: (message) => announce(message),
      optionImage: (option, index) => imageField(id, option, index).element,
      readOnly: false
    };
  }

  /** @param {QuestionType} type */
  function addMenuItem(type) {
    return { id: type, label: QUESTION_TYPES[type].label, icon: QUESTION_TYPES[type].icon };
  }

  /** @param {'first' | 'last'} [focus] */
  function openAddMenu(focus = 'first') {
    if (!editable()) return;
    const openIndex = openId ? indexOf(openId) : -1;
    showMenu(addButton, [
      ...TYPE_ORDER.map(addMenuItem),
      ...(bank ? [{ id: 'bank', label: 'From Question Bank…', icon: 'bank', separatorBefore: true }] : [])
    ], {
      label: 'Question type to add',
      focus,
      onSelect: (type) => {
        if (type === 'bank') bank?.onAdd(openIndex >= 0 ? openIndex + 1 : questions.length);
        else addQuestion(/** @type {QuestionType} */ (type));
      }
    });
  }

  if (single && questions[0] && editable()) openId = questions[0].id;
  renderList();

  return {
    /**
     * Replace every question (e.g. after loading the latest version).
     * @param {Question[]} next
     */
    setQuestions(next) {
      for (const field of imageFields.values()) field.destroy();
      imageFields.clear();
      uploads.clear();
      imageOpen.clear();
      appearancePanels.clear();
      appearanceOpen.clear();
      touched.clear();
      localErrors.clear();
      for (const node of cards.values()) node.remove();
      cards.clear();
      questions = next.slice();
      revealed = new Set(questions.map((q) => q.id));
      openId = null;
      renderList();
      emitUploads();
    },
    /** @param {{ readOnly?: ReadOnlyReason, settings?: QuizSettings, appearance?: import('./appearance.js').Appearance }} state */
    setState(state) {
      if (state.settings) settings = state.settings;
      if (state.appearance && JSON.stringify(sanitizeAppearance(state.appearance)) !== JSON.stringify(quizAppearance)) {
        // Redraw the closed cards in the new look; the open one keeps its editor.
        quizAppearance = sanitizeAppearance(state.appearance);
        questions.forEach((q) => { if (q.id !== openId) stale.add(q.id); });
        if (openId) appearancePanels.get(openId)?.refresh();
        renderList();
        return;
      }
      if (state.readOnly !== undefined && state.readOnly !== readOnly) {
        readOnly = state.readOnly;
        if (readOnly) openId = null;
        questions.forEach((q) => stale.add(q.id));
      }
      if (openId) stale.add(openId);
      renderList();
    },
    /**
     * Open a question and focus the field an issue is about (Review & Publish → Fix).
     * @param {string} id
     * @param {string} [target]
     */
    focusQuestion(id, target) {
      if (!find(id)) return;
      revealed.add(id);
      if (!editable()) {
        jumpTo(id);
        return;
      }
      if (openId === id) {
        stale.add(id);
        renderList();
      } else setOpen(id);
      const card = cards.get(id);
      if (!card) return;
      revealCard(card, { always: true });
      highlight(card);
      let control = target ? controlFor(card, id, target) : null;
      if (target === 'options') control = /** @type {HTMLElement | null} */ (card.querySelector('.option-row__text[aria-invalid="true"], .option-row__text:placeholder-shown, .choice-editor__add .btn'));
      if (target === 'correct') control = /** @type {HTMLElement | null} */ (card.querySelector('.correct-marker'));
      if (target === 'appearance') {
        if (!appearanceOpen.has(id)) toggleAppearance(id);
        control = /** @type {HTMLElement | null} */ (card.querySelector(`#qa-${safeId(id)}-textColor`));
      }
      (control || /** @type {HTMLElement | null} */ (card.querySelector('.qcard__text')))?.focus({ preventScroll: true });
    },
    /** Go to the first image that's uploading or failed. */
    focusUploads() {
      const first = [...uploads.entries()].find(([, u]) => u.status === 'failed') || [...uploads.entries()][0];
      if (!first) return;
      const [key, { questionId }] = first;
      if (openId !== questionId) setOpen(questionId);
      const field = imageFields.get(key);
      field?.element.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      /** @type {HTMLElement | null} */ (field?.element.querySelector('button'))?.focus({ preventScroll: true });
    },
    get uploads() {
      let pending = 0;
      let failed = 0;
      for (const { status } of uploads.values()) {
        if (status === 'uploading') pending += 1;
        else failed += 1;
      }
      return { pending, failed };
    },
    /**
     * Insert questions (e.g. from the Question Bank) at a position.
     * @param {Question[]} added
     * @param {number} at
     */
    insertQuestions(added, at) {
      if (!editable() || !added.length) return;
      const next = questions.slice();
      next.splice(Math.max(0, Math.min(at, next.length)), 0, ...added);
      questions = next;
      added.forEach((q) => revealed.add(q.id));
      if (openId) { revealed.add(openId); stale.add(openId); }
      openId = null;
      const nodes = [...cards.values()];
      flip(nodes, () => renderList(), { duration: 280 });
      emit();
      for (const q of added) {
        const node = cards.get(q.id);
        if (node && !prefersReducedMotion()) node.classList.add('is-fresh');
      }
      const first = cards.get(added[0].id);
      if (first) {
        revealCard(first);
        /** @type {HTMLElement | null} */ (first.querySelector('.qcard__toggle'))?.focus({ preventScroll: true });
      }
    },
    /**
     * Replace one question's content (e.g. "Update this quiz's copy" from the bank).
     * The question keeps its id and position.
     * @param {string} id
     * @param {Question} next
     */
    replaceQuestion(id, next) {
      if (!editable() || !find(id)) return;
      questions = questions.map((q) => (q.id === id ? { ...next, id, order: q.order } : q));
      appearancePanels.delete(id);
      stale.add(id);
      renderList();
      emit();
      prune();
      paint(id);
    },
    /** Link a question to a bank question (after "Save to bank"). @param {string} id @param {Question['source']} source */
    setSource(id, source) {
      if (!find(id)) return;
      update(id, { source });
      const card = cards.get(id);
      if (id === openId && card) {
        const slot = /** @type {HTMLElement | null} */ (card.querySelector(`[data-source-for="${id}"]`));
        if (slot) fillSourceBar(slot, /** @type {Question} */ (find(id)));
        const meta = card.querySelector('.qcard__meta');
        meta?.querySelector('.qcard__source')?.remove();
        const badge = sourceBadge(/** @type {Question} */ (find(id)));
        if (badge) meta?.append(badge);
      } else {
        stale.add(id);
        renderList();
      }
    },
    /**
     * The bank's latest versions, to flag "Newer version available".
     * @param {Map<string, { version: number, status: string }>} info
     */
    setBankVersions(info) {
      bankInfo = info;
      for (const q of questions) {
        if (!q.source) continue;
        if (q.id === openId) {
          const slot = /** @type {HTMLElement | null} */ (cards.get(q.id)?.querySelector(`[data-source-for="${q.id}"]`));
          if (slot) fillSourceBar(slot, q);
        } else stale.add(q.id);
      }
      renderList();
    },
    /** Show every issue in every question (before publishing). */
    revealAll() {
      questions.forEach((q) => { revealed.add(q.id); paint(q.id); });
      scheduleOutline();
    },
    destroy() {
      cleanups.forEach((cleanup) => cleanup());
      for (const field of imageFields.values()) field.destroy();
      cancelAnimationFrame(outlineFrame);
    }
  };
}

/**
 * Scroll so a card's top sits just below the sticky tabs, unless it's already
 * comfortably on screen.
 * @param {HTMLElement} card
 * @param {{ always?: boolean }} [options]
 */
function revealCard(card, { always = false } = {}) {
  const tabs = document.querySelector('.tabs-wrap');
  const top = Math.max(0, tabs ? tabs.getBoundingClientRect().bottom : 0) + 12;
  const rect = card.getBoundingClientRect();
  if (!always && rect.top >= top && rect.top <= window.innerHeight - 160) return;
  window.scrollBy({ top: rect.top - top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/** @param {DragEvent} event */
function hasFiles(event) {
  return Boolean(event.dataTransfer && [...event.dataTransfer.types].includes('Files'));
}

/**
 * Glide a redrawn element from where the old one was dropped.
 * @param {Element | null} node
 * @param {DOMRect | undefined} before
 */
function glideFrom(node, before) {
  if (!node || !before || prefersReducedMotion()) return;
  const after = node.getBoundingClientRect();
  const dy = before.top - after.top;
  if (Math.abs(dy) < 1) return;
  node.animate([{ transform: `translateY(${dy}px) scale(1.02)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
}
