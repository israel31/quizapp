// @ts-check
/**
 * The Question Bank list (question-bank.html, section 16): reusable
 * questions with search, filters (type, tag, used/unused, active/archived),
 * sorting and pages, all kept in the URL. Each row shows the type, text,
 * tags, marks, "Used in N quizzes", version and last update, with Edit,
 * Preview, Archive/Restore and Delete (only if never used).
 */
import { api } from '../api/index.js';
import { CONFIG } from '../config.js';
import { ApiError, isAbortError, userMessage } from '../api/client.js';
import { el, qs, qsa } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { formatNumber, formatRelative, formatDateTime, plural } from '../core/format.js';
import { getPref, setPref } from '../core/storage.js';
import { redirectToLogin } from '../core/session.js';
import { takeFlash } from '../core/flash.js';
import { stagger } from '../core/motion.js';
import { parseListState, listStateToSearch, isFiltered, clearFilters } from '../core/list-state.js';
import { bootPage } from '../components/shell.js';
import { toast } from '../components/toast.js';
import { openDialog, confirmDialog } from '../components/dialog.js';
import { showMenu, menuButtonAttrs } from '../components/menu.js';
import { renderPagination } from '../components/pagination.js';
import { skeleton, emptyState, errorState } from '../components/states.js';
import { QUESTION_TYPES } from '../quiz/question-types.js';
import { renderQuestion } from '../quiz/renderer.js';
import { DEFAULT_APPEARANCE, loadFonts, resolveAppearance, hasOverrides } from '../quiz/appearance.js';

/** @typedef {import('../types.js').BankQuestion} BankQuestion */
/** @typedef {import('../core/list-state.js').ListState} ListState */

const BANK_LIST_SCHEMA = Object.freeze({
  filters: Object.freeze({
    status: Object.freeze(['', 'archived']),
    type: Object.freeze(['', 'multiple_choice', 'checkboxes', 'short_answer', 'paragraph']),
    usage: Object.freeze(['', 'used', 'unused'])
  }),
  sorts: Object.freeze(['updatedAt:desc', 'updatedAt:asc', 'text:asc', 'text:desc', 'usage:desc']),
  defaultSort: 'updatedAt:desc'
});
const USAGE_LABELS = { used: 'Used in quizzes', unused: 'Not used yet' };

const listHost = /** @type {HTMLElement} */ (qs('[data-list]'));
const countEl = /** @type {HTMLElement} */ (qs('[data-list-count]'));
const chipsHost = /** @type {HTMLElement} */ (qs('[data-filter-chips]'));
const pagingHost = /** @type {HTMLElement} */ (qs('[data-pagination]'));
const searchInput = /** @type {HTMLInputElement} */ (qs('#bank-search'));
const searchClear = /** @type {HTMLButtonElement} */ (qs('[data-search-clear]'));
const searchSpinner = /** @type {HTMLElement} */ (qs('[data-search-spinner]'));
const typeSelect = /** @type {HTMLSelectElement} */ (qs('#bank-type'));
const tagSelect = /** @type {HTMLSelectElement} */ (qs('#bank-tag'));
const usageSelect = /** @type {HTMLSelectElement} */ (qs('#bank-usage'));
const sortSelect = /** @type {HTMLSelectElement} */ (qs('#bank-sort'));
const statusRadios = /** @type {HTMLInputElement[]} */ (qsa('input[name="status"]'));
const newButton = /** @type {HTMLAnchorElement} */ (qs('[data-new-question]'));

/** The URL state, plus the tag (free text, so it's kept outside the schema). */
let query = readQuery();
let pageSize = savedPageSize();
/** @type {AbortController | null} */
let inFlight = null;
let searchTimer = 0;
let firstLoad = true;
/** @type {BankQuestion[]} */
let items = [];

function savedPageSize() {
  const saved = Number(getPref('rows'));
  return CONFIG.PAGE_SIZES.includes(saved) ? saved : CONFIG.PAGE_SIZE_DEFAULT;
}

/** @returns {ListState & { tag: string }} */
function readQuery() {
  const params = new URLSearchParams(window.location.search);
  const state = parseListState(params, BANK_LIST_SCHEMA);
  return { ...state, tag: (params.get('tag') || '').replace(/\s+/g, ' ').trim().slice(0, 30) };
}

/** @param {ListState & { tag: string }} state */
function urlFor(state) {
  const base = listStateToSearch(state, BANK_LIST_SCHEMA);
  const params = new URLSearchParams(base);
  if (state.tag) params.set('tag', state.tag);
  const text = params.toString();
  return `${window.location.pathname}${text ? `?${text}` : ''}`;
}

/** @param {BankQuestion} q */
const editUrl = (q) => `question-edit.html?id=${encodeURIComponent(q.id)}`;

bootPage({
  page: 'question-bank',
  title: 'Question Bank',
  onReady: () => {
    newButton.hidden = false;
    newButton.classList.add('fade-in');
    syncControls();
    wire();
    load();
    loadTags();
    const flash = takeFlash();
    if (flash) toast({ type: flash.type, message: flash.message });
  }
});

// Loading ----------------------------------------------------------------------------

async function load() {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  if (firstLoad) listHost.replaceChildren(skeleton({ label: 'Loading questions…', lines: 5 }));
  else listHost.setAttribute('aria-busy', 'true');
  searchSpinner.hidden = !query.q;
  try {
    const page = await api.listBankQuestions({
      q: query.q, type: query.filters.type, tag: query.tag, usage: query.filters.usage,
      status: query.filters.status || 'active', sort: query.sort, page: query.page, pageSize
    }, { signal: controller.signal });
    if (controller !== inFlight) return;
    // A page past the end (e.g. after deleting the last row): go to the last real page.
    const lastPage = Math.max(1, Math.ceil(page.total / pageSize));
    if (query.page > lastPage && page.total > 0) {
      setQuery({ ...query, page: lastPage }, { replace: true });
      return;
    }
    items = page.items;
    render(page.total);
  } catch (error) {
    if (isAbortError(error)) return;
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    countEl.textContent = '';
    pagingHost.replaceChildren();
    listHost.replaceChildren(errorState({ title: 'The Question Bank didn’t load', message: userMessage(error), onRetry: () => load() }));
  } finally {
    if (controller === inFlight) {
      inFlight = null;
      searchSpinner.hidden = true;
      listHost.removeAttribute('aria-busy');
    }
  }
}

async function loadTags() {
  try {
    const tags = await api.listBankTags();
    const keep = query.tag;
    tagSelect.replaceChildren(el('option', { value: '', text: 'All tags' }), ...tags.map((tag) => el('option', { value: tag, text: tag })));
    if (keep && !tags.includes(keep)) tagSelect.append(el('option', { value: keep, text: keep }));
    tagSelect.value = keep;
  } catch {
    /* the tag filter stays at "All tags" */
  }
}

/**
 * @param {ListState & { tag: string }} next
 * @param {{ replace?: boolean }} [options]
 */
function setQuery(next, { replace = false } = {}) {
  query = next;
  const url = urlFor(query);
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  syncControls();
  load();
}

// Rendering --------------------------------------------------------------------------

/** @param {number} total */
function render(total) {
  const archived = query.filters.status === 'archived';
  countEl.textContent = total ? `${plural(total, archived ? 'archived question' : 'question')}` : '';
  renderChips();

  if (!items.length) {
    pagingHost.replaceChildren();
    const filtered = isFiltered({ ...query, filters: { ...query.filters, status: '' } }) || Boolean(query.tag);
    const clear = { label: 'Clear filters', variant: /** @type {const} */ ('ghost'), onClick: clearAll };
    listHost.replaceChildren(filtered
      ? emptyState({ iconName: 'searchX', title: 'No questions match', message: 'Try other words, or clear the filters.', actions: [clear] })
      : archived
        ? emptyState({ iconName: 'archive', title: 'No archived questions', message: 'Questions you archive appear here. They’re hidden from the quiz picker but keep working in quizzes that use them.' })
        : emptyState({
          iconName: 'bank',
          title: 'Your Question Bank is empty',
          message: 'Create a question here, or use “Save to bank” on any question in a quiz.',
          actions: [{ label: 'New question', href: 'question-edit.html?new', variant: 'primary' }]
        }));
    return;
  }

  const list = el('ul', { class: 'bank-list', attrs: { 'aria-label': archived ? 'Archived questions' : 'Questions' } }, items.map(row));
  listHost.replaceChildren(list);
  if (firstLoad) stagger([...list.children]);
  firstLoad = false;

  pagingHost.replaceChildren(renderPagination({
    page: query.page,
    pageSize,
    total,
    pageSizes: CONFIG.PAGE_SIZES,
    noun: 'questions',
    hrefFor: (page) => urlFor({ ...query, page }),
    onPage: (page) => {
      setQuery({ ...query, page });
      qs('[data-bank-list]')?.scrollIntoView({ block: 'start' });
    },
    onPageSize: (size) => {
      pageSize = size;
      setPref('rows', String(size));
      setQuery({ ...query, page: 1 }, { replace: true });
    }
  }));
}

/** @param {BankQuestion} q */
function row(q) {
  const def = QUESTION_TYPES[q.type];
  const more = el('button', { type: 'button', class: 'btn btn--ghost btn--icon row-menu', attrs: { 'aria-label': `More actions for: ${q.text.trim() || 'question'}` } }, icon('more', { size: 20 }));
  menuButtonAttrs(more);
  more.addEventListener('click', () => openRowMenu(q, more));
  more.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openRowMenu(q, more, event.key === 'ArrowUp' ? 'last' : 'first');
    }
  });
  return el('li', { class: ['bank-row', q.status === 'archived' ? 'is-archived' : ''], data: { id: q.id } },
    el('span', { class: 'bank-row__type', attrs: { 'aria-hidden': 'true', title: def?.label || '' } }, icon(def?.icon || 'quizzes', { size: 18 })),
    el('div', { class: 'bank-row__main' },
      el('a', { class: ['bank-row__text', q.text.trim() ? '' : 'is-missing'], href: editUrl(q), text: q.text.trim() || 'No question text' }),
      el('p', { class: 'bank-row__meta' },
        el('span', { text: def?.label || 'Question' }),
        el('span', { text: plural(q.marks, 'mark') }),
        hasOverrides(q.appearance) ? el('span', { class: 'bank-row__custom' }, icon('palette', { size: 13 }), el('span', { text: 'Custom style' })) : null),
      q.tags.length ? el('ul', { class: 'bank-row__tags', attrs: { 'aria-label': 'Tags' } }, q.tags.map((tag) => el('li', {},
        el('button', { type: 'button', class: 'bank-tag bank-tag--button', attrs: { 'aria-label': `Show questions tagged ${tag}` }, on: { click: () => setQuery({ ...query, tag, page: 1 }) } }, tag)))) : null),
    el('dl', { class: 'bank-row__facts' },
      el('div', {}, el('dt', { class: 'sr-only', text: 'Used in' }),
        el('dd', { class: ['bank-row__usage', q.usedInQuizCount ? 'is-used' : ''], text: q.usedInQuizCount ? `Used in ${plural(q.usedInQuizCount, 'quiz', 'quizzes')}` : 'Not used yet' })),
      el('div', {}, el('dt', { class: 'sr-only', text: 'Version' }), el('dd', { class: 'bank-version num', text: `v${q.version}` })),
      el('div', {}, el('dt', { class: 'sr-only', text: 'Last updated' }),
        el('dd', { class: 'bank-row__updated', attrs: { title: formatDateTime(q.updatedAt) }, text: `Updated ${formatRelative(q.updatedAt)}` }))),
    more);
}

function renderChips() {
  /** @type {{ label: string, clear: () => void }[]} */
  const chips = [];
  if (query.q) chips.push({ label: `“${query.q}”`, clear: () => { searchInput.value = ''; setQuery({ ...query, q: '', page: 1 }); } });
  if (query.filters.type) chips.push({ label: QUESTION_TYPES[/** @type {keyof typeof QUESTION_TYPES} */ (query.filters.type)].label, clear: () => setQuery({ ...query, filters: { ...query.filters, type: '' }, page: 1 }) });
  if (query.tag) chips.push({ label: `Tag: ${query.tag}`, clear: () => setQuery({ ...query, tag: '', page: 1 }) });
  if (query.filters.usage) chips.push({ label: /** @type {any} */ (USAGE_LABELS)[query.filters.usage], clear: () => setQuery({ ...query, filters: { ...query.filters, usage: '' }, page: 1 }) });
  chipsHost.replaceChildren(...chips.map(({ label, clear }) => el('li', { class: 'chip chip--enter' },
    el('span', { class: 'chip__label', text: label }),
    el('button', { type: 'button', class: 'chip__remove', attrs: { 'aria-label': `Remove filter: ${label}` }, on: { click: clear } }, icon('close', { size: 14 })))),
  ...(chips.length > 1 ? [el('li', {}, el('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: clearAll } }, el('span', { class: 'btn__label', text: 'Clear filters' })))] : []));
}

function clearAll() {
  searchInput.value = '';
  setQuery({ ...clearFilters(query), filters: { ...clearFilters(query).filters, status: query.filters.status }, tag: '' });
}

function syncControls() {
  if (document.activeElement !== searchInput) searchInput.value = query.q;
  searchClear.hidden = !searchInput.value;
  typeSelect.value = query.filters.type;
  usageSelect.value = query.filters.usage;
  sortSelect.value = query.sort;
  if ([...tagSelect.options].some((o) => o.value === query.tag)) tagSelect.value = query.tag;
  else if (query.tag) {
    tagSelect.append(el('option', { value: query.tag, text: query.tag }));
    tagSelect.value = query.tag;
  } else tagSelect.value = '';
  statusRadios.forEach((radio) => { radio.checked = radio.value === query.filters.status; });
}

function wire() {
  const commitSearch = () => {
    window.clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (q !== query.q) setQuery({ ...query, q, page: 1 }, { replace: true });
  };
  searchInput.addEventListener('input', () => {
    searchClear.hidden = !searchInput.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(commitSearch, 300);
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commitSearch(); }
    if (event.key === 'Escape' && searchInput.value) { event.preventDefault(); searchInput.value = ''; commitSearch(); }
  });
  searchClear.addEventListener('click', () => { searchInput.value = ''; commitSearch(); searchInput.focus(); });
  typeSelect.addEventListener('change', () => setQuery({ ...query, filters: { ...query.filters, type: typeSelect.value }, page: 1 }));
  tagSelect.addEventListener('change', () => setQuery({ ...query, tag: tagSelect.value, page: 1 }));
  usageSelect.addEventListener('change', () => setQuery({ ...query, filters: { ...query.filters, usage: usageSelect.value }, page: 1 }));
  sortSelect.addEventListener('change', () => setQuery({ ...query, sort: sortSelect.value, page: 1 }));
  statusRadios.forEach((radio) => radio.addEventListener('change', () => {
    if (radio.checked) setQuery({ ...query, filters: { ...query.filters, status: radio.value }, page: 1 });
  }));
  window.addEventListener('popstate', () => {
    query = readQuery();
    syncControls();
    load();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('input, textarea, select, [contenteditable="true"], dialog[open]')) return;
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  });
}

// Actions ------------------------------------------------------------------------------

/** @param {BankQuestion} q @param {HTMLElement} trigger @param {'first' | 'last'} [focus] */
function openRowMenu(q, trigger, focus = 'first') {
  /** @type {import('../components/menu.js').MenuItem[]} */
  const menuItems = [
    { id: 'edit', label: q.status === 'archived' ? 'Open' : 'Edit', icon: 'edit' },
    { id: 'preview', label: 'Preview', icon: 'eye' }
  ];
  if (q.status === 'archived') menuItems.push({ id: 'restore', label: 'Restore', icon: 'restore' });
  else menuItems.push({ id: 'archive', label: 'Archive', icon: 'archive' });
  menuItems.push({ id: 'delete', label: 'Delete…', icon: 'trash', tone: 'danger', separatorBefore: true });
  showMenu(trigger, menuItems, {
    label: 'Question actions',
    focus,
    onSelect: (id) => {
      if (id === 'edit') window.location.href = editUrl(q);
      if (id === 'preview') previewQuestion(q);
      if (id === 'archive') setStatus(q, 'archive');
      if (id === 'restore') setStatus(q, 'restore');
      if (id === 'delete') removeQuestion(q);
    }
  });
}

/** A bank question as participants would see it, in the default look. @param {BankQuestion} q */
function previewQuestion(q) {
  loadFonts([resolveAppearance(DEFAULT_APPEARANCE, q.appearance).fontFamily]);
  const page = el('div', { class: 'appearance-sample__page' }, renderQuestion(q, DEFAULT_APPEARANCE, { showCorrect: true }));
  page.style.background = DEFAULT_APPEARANCE.pageBackground;
  openDialog({
    title: 'Preview',
    body: [
      el('p', { class: 'bank-preview__meta' }, `${QUESTION_TYPES[q.type]?.label || 'Question'} · ${plural(q.marks, 'mark')} · version ${formatNumber(q.version)} · ${q.usedInQuizCount ? `used in ${plural(q.usedInQuizCount, 'quiz', 'quizzes')}` : 'not used yet'}`),
      page,
      el('p', { class: 'field__hint', text: 'Shown in the default JCI Classic look, with correct answers marked. Each quiz uses its own colours and fonts.' })
    ],
    actions: [
      { label: 'Close', value: 'close', variant: 'ghost', autofocus: true },
      { label: q.status === 'archived' ? 'Open' : 'Edit', value: 'edit', variant: 'primary' }
    ]
  }).then((choice) => { if (choice === 'edit') window.location.href = editUrl(q); });
}

/** @param {BankQuestion} q @param {'archive' | 'restore'} action */
async function setStatus(q, action) {
  try {
    if (action === 'archive') await api.archiveBankQuestion(q.id);
    else await api.restoreBankQuestion(q.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { redirectToLogin(); return; }
    toast({ type: 'error', message: `Couldn’t ${action} the question. ${userMessage(error)}` });
    return;
  }
  toast(action === 'archive'
    ? {
      type: 'success',
      message: 'Archived. It’s hidden from the quiz picker; quizzes that use it keep their copy.',
      duration: 6000,
      action: { label: 'Undo', onClick: () => setStatus(q, 'restore') }
    }
    : { type: 'success', message: 'Restored. It’s back in the quiz picker.' });
  announce(action === 'archive' ? 'Question archived.' : 'Question restored.');
  load();
}

/** @param {BankQuestion} q */
async function removeQuestion(q) {
  if (q.usedInQuizCount > 0) {
    const choice = await openDialog({
      title: 'This question can’t be deleted',
      body: [`It’s used in ${plural(q.usedInQuizCount, 'quiz', 'quizzes')}, so deleting it would break the link to where those copies came from. Archive it instead: it’s hidden from the picker and those quizzes keep working.`],
      actions: [
        { label: 'Cancel', value: 'cancel', variant: 'ghost' },
        ...(q.status === 'archived' ? [] : [{ label: 'Archive instead', value: 'archive', variant: /** @type {const} */ ('primary'), autofocus: true }])
      ]
    });
    if (choice === 'archive') setStatus(q, 'archive');
    return;
  }
  const confirmed = await confirmDialog({
    title: 'Delete this question?',
    message: [`“${q.text.trim() || 'Untitled question'}” will be removed from the Question Bank for good. No quiz uses it, so nothing else changes.`],
    confirmLabel: 'Delete question',
    tone: 'danger'
  });
  if (!confirmed) return;
  try {
    await api.deleteBankQuestion(q.id);
    toast({ type: 'success', message: 'Question deleted from the bank.' });
    load();
    loadTags();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) { redirectToLogin(); return; }
    toast({ type: 'error', message: `Couldn’t delete it. ${userMessage(error)}` });
  }
}
