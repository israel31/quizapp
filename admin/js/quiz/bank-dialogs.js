// @ts-check
/**
 * The Question Bank inside a quiz (section 16):
 * - pickFromBank: "Add from Question Bank", with search and filters; choose
 *   several, then "Add N questions".
 * - saveToBank: "Save to Question Bank" creates a new bank entry (version 1)
 *   from a quiz question, with optional tags.
 * - reviewUpdate: the quiz's copy and the bank's newer version side by side,
 *   with "Update this quiz's copy" (only when the quiz isn't locked).
 */
import { api } from '../api/index.js';
import { ApiError, isAbortError, userMessage } from '../api/client.js';
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { plural } from '../core/format.js';
import { formDialog, openDialog } from '../components/dialog.js';
import { skeleton, errorState } from '../components/states.js';
import { createTagInput } from '../components/tag-input.js';
import { QUESTION_TYPES, TYPE_ORDER, validateQuestion } from './question-types.js';
import { bankDraftFromQuestion, questionDifferences } from './question-model.js';
import { renderQuestion } from './renderer.js';
import { loadFonts, resolveAppearance } from './appearance.js';

/** @typedef {import('../types.js').BankQuestion} BankQuestion */
/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('./appearance.js').Appearance} Appearance */

let counter = 0;
const PAGE_SIZE = 10;

/**
 * A modal dialog shell with the site's dialog styles; resolves on close.
 * @param {string} className
 * @param {string} titleId
 */
function shell(className, titleId) {
  const opener = /** @type {HTMLElement | null} */ (document.activeElement);
  const dialog = el('dialog', { class: ['dialog', 'dialog--wide', className], attrs: { 'aria-labelledby': titleId } });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    window.setTimeout(() => dialog.remove(), 400);
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  });
  return dialog;
}

/** One line about a bank question: type, marks, version, usage. @param {BankQuestion} q */
export function bankMeta(q) {
  const def = QUESTION_TYPES[q.type];
  return `${def ? def.label : 'Question'} · ${plural(q.marks, 'mark')} · v${q.version} · ${q.usedInQuizCount ? `Used in ${plural(q.usedInQuizCount, 'quiz', 'quizzes')}` : 'Not used yet'}`;
}

/**
 * "Add from Question Bank": search, filter and choose several active bank
 * questions. Resolves with the chosen ones (in the order chosen), or null.
 * @param {{ quizAppearance: Appearance }} options
 * @returns {Promise<BankQuestion[] | null>}
 */
export function pickFromBank({ quizAppearance }) {
  return new Promise((resolve) => {
    const id = `bank-picker-${++counter}`;
    /** @type {Map<string, BankQuestion>} */
    const chosen = new Map();
    let page = 1;
    let total = 0;
    /** @type {AbortController | null} */
    let controller = null;
    let timer = 0;
    /** @type {BankQuestion[] | null} */
    let result = null;

    const search = el('input', { class: 'input', type: 'search', id: `${id}-search`, attrs: { placeholder: 'Search questions, answers and tags', autocomplete: 'off' } });
    const typeSelect = el('select', { class: 'select select--compact', id: `${id}-type`, attrs: { 'aria-label': 'Question type' } },
      el('option', { value: '', text: 'All types' }),
      TYPE_ORDER.map((type) => el('option', { value: type, text: QUESTION_TYPES[type].label })));
    const tagSelect = el('select', { class: 'select select--compact', id: `${id}-tag`, attrs: { 'aria-label': 'Tag' } }, el('option', { value: '', text: 'All tags' }));
    const count = el('p', { class: 'bank-picker__count', attrs: { 'aria-live': 'polite' } });
    const list = el('ul', { class: 'bank-picker__list', attrs: { 'aria-label': 'Bank questions' } });
    const more = el('button', { type: 'button', class: 'btn btn--small bank-picker__more', hidden: true, on: { click: () => load(page + 1) } },
      el('span', { class: 'btn__label', text: 'Show more' }));
    const status = el('div', { class: 'bank-picker__status' });
    const selected = el('p', { class: 'bank-picker__selected', attrs: { 'aria-live': 'polite' } });
    const addButton = el('button', { type: 'button', class: 'btn btn--primary', disabled: true, on: { click: () => { result = [...chosen.values()]; dialog.close(); } } },
      el('span', { class: 'btn__label', text: 'Add questions' }));

    const dialog = shell('bank-picker', `${id}-title`);
    dialog.append(el('div', { class: 'dialog__panel' },
      el('div', { class: 'dialog__header' },
        el('h2', { id: `${id}-title`, text: 'Add from Question Bank' }),
        el('p', { class: 'dialog__description', text: 'Choose questions to copy into this quiz. Each copy remembers which bank version it came from.' })),
      el('div', { class: 'bank-picker__filters' },
        el('label', { class: 'sr-only', for: `${id}-search`, text: 'Search the Question Bank' }),
        search, typeSelect, tagSelect),
      el('div', { class: 'dialog__body bank-picker__body' }, count, status, list, more),
      el('div', { class: 'dialog__footer' },
        selected,
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Cancel', on: { click: () => dialog.close() } }),
        addButton)));
    dialog.addEventListener('close', () => {
      controller?.abort();
      window.clearTimeout(timer);
      resolve(result);
    });

    function updateSelected() {
      const n = chosen.size;
      selected.textContent = n ? `${plural(n, 'question')} selected` : 'None selected';
      addButton.disabled = n === 0;
      /** @type {HTMLElement} */ (addButton.querySelector('.btn__label')).textContent = n ? `Add ${plural(n, 'question')}` : 'Add questions';
    }

    /** @param {BankQuestion} q */
    function row(q) {
      const checkId = `${id}-q-${q.id}`;
      const box = el('input', { type: 'checkbox', id: checkId, checked: chosen.has(q.id), attrs: { 'aria-describedby': `${checkId}-meta` } });
      box.addEventListener('change', () => {
        if (box.checked) chosen.set(q.id, q);
        else chosen.delete(q.id);
        item.classList.toggle('is-chosen', box.checked);
        updateSelected();
      });
      const previewHost = el('div', { class: 'bank-pick__preview', hidden: true });
      const toggle = el('button', {
        type: 'button',
        class: 'btn btn--small btn--ghost',
        attrs: { 'aria-expanded': 'false', 'aria-controls': `${checkId}-preview` },
        on: {
          click: () => {
            const open = previewHost.hidden;
            previewHost.hidden = !open;
            toggle.setAttribute('aria-expanded', String(open));
            /** @type {HTMLElement} */ (toggle.querySelector('.btn__label')).textContent = open ? 'Hide preview' : 'Preview';
            if (open && !previewHost.childElementCount) {
              loadFonts([resolveAppearance(quizAppearance, q.appearance).fontFamily]);
              const page = el('div', { class: 'appearance-sample__page' }, renderQuestion(q, quizAppearance, { showCorrect: true }));
              page.style.background = quizAppearance.pageBackground;
              previewHost.append(page);
            }
          }
        }
      }, icon('eye', { size: 16 }), el('span', { class: 'btn__label', text: 'Preview' }));
      previewHost.id = `${checkId}-preview`;
      const item = el('li', { class: ['bank-pick', chosen.has(q.id) ? 'is-chosen' : ''] },
        el('div', { class: 'bank-pick__row' },
          box,
          el('label', { class: 'bank-pick__label', for: checkId },
            el('span', { class: 'bank-pick__text', text: q.text.trim() || 'No question text' }),
            el('span', { class: 'bank-pick__meta', id: `${checkId}-meta` },
              icon(QUESTION_TYPES[q.type]?.icon || 'quizzes', { size: 14 }), el('span', { text: bankMeta(q) })),
            q.tags.length ? el('span', { class: 'bank-pick__tags' }, q.tags.map((tag) => el('span', { class: 'bank-tag', text: tag }))) : null),
          toggle),
        previewHost);
      return item;
    }

    /** @param {number} nextPage */
    async function load(nextPage = 1) {
      controller?.abort();
      controller = new AbortController();
      if (nextPage === 1) {
        list.replaceChildren();
        status.replaceChildren(skeleton({ label: 'Loading questions…', lines: 3 }));
        more.hidden = true;
      } else more.disabled = true;
      try {
        const result = await api.listBankQuestions({ q: search.value, type: typeSelect.value, tag: tagSelect.value, status: 'active', page: nextPage, pageSize: PAGE_SIZE }, { signal: controller.signal });
        page = result.page;
        total = result.total;
        status.replaceChildren();
        list.append(...result.items.map(row));
        count.textContent = total ? `${plural(total, 'question')}${search.value.trim() || typeSelect.value || tagSelect.value ? ' match' : ' in the bank'}` : '';
        if (!total) {
          status.replaceChildren(el('p', { class: 'bank-picker__empty' }, icon('searchX', { size: 20 }),
            el('span', { text: search.value.trim() || typeSelect.value || tagSelect.value ? 'No bank questions match. Try other words or filters.' : 'The Question Bank is empty. Save questions to it from any quiz.' })));
        }
        more.hidden = page * PAGE_SIZE >= total;
        more.disabled = false;
      } catch (error) {
        if (isAbortError(error)) return;
        more.disabled = false;
        status.replaceChildren(errorState({ title: 'The Question Bank didn’t load', message: userMessage(error), onRetry: () => load(nextPage) }));
      }
    }

    search.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => load(1), 300);
    });
    typeSelect.addEventListener('change', () => load(1));
    tagSelect.addEventListener('change', () => load(1));

    document.body.appendChild(dialog);
    dialog.showModal();
    search.focus();
    updateSelected();
    load(1);
    api.listBankTags().then((tags) => {
      tagSelect.append(...tags.map((tag) => el('option', { value: tag, text: tag })));
    }, () => { /* tags are optional; the filter just stays at "All tags" */ });
  });
}

/**
 * "Save to Question Bank": a new bank question (version 1) from a quiz
 * question, with optional tags. Resolves with the new bank question, or null.
 * @param {Question} question
 * @returns {Promise<BankQuestion | null>}
 */
export async function saveToBank(question) {
  const errors = validateQuestion(question).filter((issue) => issue.level === 'error');
  if (errors.some((issue) => issue.code === 'text')) {
    announce('Add the question text before saving it to the bank.');
    await openDialog({
      title: 'Add the question text first',
      body: 'A bank question needs its text, so it makes sense when someone reuses it. Type the question, then choose Save to bank again.',
      actions: [{ label: 'OK', value: 'ok', variant: 'primary', autofocus: true }]
    });
    return null;
  }
  const tagsId = `bank-save-tags-${++counter}`;
  const errorBox = el('p', { class: 'form-error', attrs: { role: 'alert' }, hidden: true });
  let tags = /** @type {string[]} */ ([]);
  const tagInput = createTagInput({ id: tagsId, tags, onChange: (next) => { tags = next; }, describedBy: `${tagsId}-hint` });
  api.listBankTags().then((list) => tagInput.setSuggestions(list), () => {});
  return formDialog({
    title: 'Save to Question Bank',
    description: 'A copy goes into the bank as a new question (version 1), so you can reuse it in other quizzes. This quiz keeps its own copy, linked to it.',
    body: [
      el('div', { class: 'field' },
        el('label', { class: 'field__label', for: tagsId, text: 'Tags (optional)' }),
        tagInput.element,
        el('p', { class: 'field__hint', id: `${tagsId}-hint`, text: 'Short words to find it later, like “Leadership”. Press Enter after each one.' })),
      errors.length ? el('p', { class: 'bank-save__note' }, icon('alertTriangle', { size: 16 }),
        el('span', { text: `This question still has ${plural(errors.length, 'thing')} to fix. You can save it now and fix it in the bank later.` })) : null,
      errorBox
    ].filter((node) => node !== null).map((node) => /** @type {Node} */ (node)),
    submitLabel: 'Save to bank',
    onSubmit: async () => {
      errorBox.hidden = true;
      // A tag still in the box counts too.
      if (tagInput.input.value.trim()) tags = [...tags, tagInput.input.value.trim()];
      try {
        return await api.createBankQuestion(bankDraftFromQuestion(question), { tags });
      } catch (error) {
        errorBox.hidden = false;
        errorBox.textContent = error instanceof ApiError && error.status === 401
          ? 'Your session has ended. Sign in again in another tab, then try once more.'
          : `Couldn’t save it to the bank. ${userMessage(error)}`;
        return undefined;
      }
    }
  });
}

/**
 * Review a newer bank version: this quiz's copy and the bank's latest side by
 * side, with what changed. Resolves true if the admin chose to update.
 * @param {{
 *   question: Question,
 *   bankQuestion: BankQuestion,
 *   quizAppearance: Appearance,
 *   canUpdate: boolean,
 *   lockedMessage?: string
 * }} options
 * @returns {Promise<boolean>}
 */
export function reviewUpdate({ question, bankQuestion, quizAppearance, canUpdate, lockedMessage }) {
  return new Promise((resolve) => {
    const id = `bank-review-${++counter}`;
    let update = false;
    const changes = questionDifferences(question, bankQuestion);
    const from = question.source?.bankVersion ?? 0;

    /** @param {string} caption @param {import('./renderer.js').RenderQuestion} q @param {string} [tone] */
    const side = (caption, q, tone = '') => {
      loadFonts([resolveAppearance(quizAppearance, q.appearance).fontFamily]);
      const page = el('div', { class: 'appearance-sample__page' }, renderQuestion(q, quizAppearance, { showCorrect: true }));
      page.style.background = quizAppearance.pageBackground;
      return el('figure', { class: ['version-compare__side', tone] }, el('figcaption', { class: 'version-compare__caption', text: caption }), page);
    };

    const updateButton = el('button', { type: 'button', class: 'btn btn--primary', disabled: !canUpdate, on: { click: () => { update = true; dialog.close(); } } },
      el('span', { class: 'btn__label', text: 'Update this quiz’s copy' }));
    const dialog = shell('bank-review', `${id}-title`);
    dialog.append(el('div', { class: 'dialog__panel' },
      el('div', { class: 'dialog__header' },
        el('h2', { id: `${id}-title`, text: 'Review update' }),
        el('p', { class: 'dialog__description', text: `The Question Bank has version ${bankQuestion.version}. This quiz uses its own copy of version ${from}.` })),
      el('div', { class: 'dialog__body' },
        el('p', { class: 'version-compare__changes' },
          el('strong', { text: 'What changed: ' }),
          el('span', { text: changes.length ? changes.join(', ') : 'nothing in the content (only details like tags)' })),
        el('div', { class: 'version-compare' },
          side(`This quiz’s copy · v${from}`, question),
          side(`Question Bank · v${bankQuestion.version} (latest)`, bankQuestion, 'is-latest')),
        el('p', { class: 'version-compare__note' }, icon('info', { size: 16 }),
          el('span', { text: canUpdate
            ? 'Updating replaces this quiz’s copy with the bank version. Participants who already took the quiz keep what they saw.'
            : (lockedMessage || 'This quiz can’t be changed right now.') }))),
      el('div', { class: 'dialog__footer' },
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Keep this quiz’s copy', on: { click: () => dialog.close() } }),
        updateButton)));
    dialog.addEventListener('close', () => resolve(update));
    document.body.appendChild(dialog);
    dialog.showModal();
    /** @type {HTMLElement} */ (dialog.querySelector('.dialog__footer .btn--ghost')).focus();
  });
}
