// @ts-check
/**
 * Results (results.html, section 24).
 * - No quiz chosen: the quizzes participants have taken, with attempt counts
 *   and how many attempts wait for grading.
 * - ?quiz=ID: a summary strip (from the backend), then the attempts table:
 *   participant (name and email), attempt, submitted, time taken, score,
 *   percentage and status, with search, status and date filters, sorting and
 *   pages, all kept in the URL.
 * Scores come from the backend; nothing is calculated here. There's no CSV
 * button: export isn't approved yet (pending decision 7).
 */
import { api } from '../api/index.js';
import { CONFIG } from '../config.js';
import { ApiError, isAbortError, userMessage } from '../api/client.js';
import { el, qs } from '../core/dom.js';
import { icon } from '../icons.js';
import { formatDateTime, formatNumber, formatRelative, plural } from '../core/format.js';
import { getPref, setPref } from '../core/storage.js';
import { redirectToLogin } from '../core/session.js';
import { stagger } from '../core/motion.js';
import { parseListState, listStateToSearch, isFiltered, clearFilters } from '../core/list-state.js';
import { bootPage } from '../components/shell.js';
import { renderPagination } from '../components/pagination.js';
import { skeleton, emptyState, errorState } from '../components/states.js';
import { statusBadge, attemptBadge } from '../components/badge.js';
import { ATTEMPT_STATUS_META, ATTEMPT_SORTS, RESULTS_LIST_SCHEMA, timeTaken, percentOf, scoreText } from '../quiz/results-rules.js';

/** @typedef {import('../types.js').AttemptSummary} AttemptSummary */
/** @typedef {import('../types.js').Quiz} Quiz */
/** @typedef {import('../core/list-state.js').ListState} ListState */

const OVERVIEW_SCHEMA = Object.freeze({
  filters: Object.freeze({}),
  sorts: Object.freeze(['attemptCount:desc', 'updatedAt:desc', 'title:asc']),
  defaultSort: 'attemptCount:desc'
});
const OVERVIEW_SORTS = [['attemptCount:desc', 'Most attempts'], ['updatedAt:desc', 'Recently updated'], ['title:asc', 'Title A–Z']];

const params = new URLSearchParams(window.location.search);
const quizId = params.get('quiz') || '';
const body = /** @type {HTMLElement} */ (qs('[data-results-body]'));
const titleEl = /** @type {HTMLElement} */ (qs('[data-results-title]'));
const descEl = /** @type {HTMLElement} */ (qs('[data-results-desc]'));
const badgesEl = /** @type {HTMLElement} */ (qs('[data-results-badges]'));
const actionsEl = /** @type {HTMLElement} */ (qs('[data-results-actions]'));
const crumbs = /** @type {HTMLElement} */ (qs('[data-results-crumbs]'));
const crumbTitle = /** @type {HTMLElement} */ (qs('[data-crumb-title]'));

let pageSize = savedPageSize();
/** @type {AbortController | null} */
let inFlight = null;
let searchTimer = 0;
let firstLoad = true;

function savedPageSize() {
  const saved = Number(getPref('rows'));
  return CONFIG.PAGE_SIZES.includes(saved) ? saved : CONFIG.PAGE_SIZE_DEFAULT;
}

/** @param {unknown} error */
function handleAuth(error) {
  if (error instanceof ApiError && error.status === 401) {
    redirectToLogin();
    return true;
  }
  return false;
}

bootPage({ page: 'results', title: 'Results', onReady: () => (quizId ? startQuiz() : startOverview()) });

/** A search box like the other lists'. @param {string} id @param {string} label @param {string} placeholder */
function searchField(id, label, placeholder) {
  const input = el('input', { class: 'input search-field__input', id, type: 'search', attrs: { placeholder, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' } });
  const clear = el('button', { type: 'button', class: 'search-field__clear', hidden: true, attrs: { 'aria-label': 'Clear search' } }, icon('close', { size: 16 }));
  const spinner = el('span', { class: 'spinner search-field__spinner', hidden: true });
  const element = el('div', { class: 'search-field', attrs: { role: 'search' } },
    el('label', { class: 'sr-only', for: id, text: label }),
    icon('search', { size: 18, className: 'search-field__icon' }),
    input,
    el('span', { class: 'search-field__end' }, spinner, clear));
  return { element, input, clear, spinner };
}

/** @param {string} id @param {string} label @param {string} iconName @param {[string, string][]} options */
function selectField(id, label, iconName, options) {
  const select = el('select', { class: 'select', id }, options.map(([value, text]) => el('option', { value, text })));
  return { select, element: el('div', { class: 'toolbar-select' }, el('label', { class: 'sr-only', for: id, text: label }), icon(iconName, { size: 16, className: 'toolbar-select__icon' }), select) };
}

// Overview: quizzes with attempts ---------------------------------------------------------

function startOverview() {
  let query = parseListState(window.location.search, OVERVIEW_SCHEMA);
  const search = searchField('results-search', 'Search quizzes', 'Search quizzes');
  const sort = selectField('results-sort', 'Sort by', 'arrowUpDown', OVERVIEW_SORTS.map(([v, l]) => [v, `Sort: ${l}`]));
  const count = el('p', { class: 'list-meta__count num' });
  const list = el('div', { class: 'list-body results-list' });
  const paging = el('div', { class: 'list-footer' });
  body.replaceChildren(el('section', { class: 'list-panel', attrs: { 'aria-label': 'Quizzes with results' } },
    el('div', { class: 'list-toolbar' }, el('div', { class: 'list-toolbar__row results-toolbar' }, search.element, sort.element)),
    el('div', { class: 'list-meta' }, count),
    list,
    paging));

  const sync = () => {
    if (document.activeElement !== search.input) search.input.value = query.q;
    search.clear.hidden = !search.input.value;
    sort.select.value = query.sort;
  };
  /** @param {ListState} next @param {boolean} [replace] */
  const setQuery = (next, replace = false) => {
    query = next;
    const url = `${window.location.pathname}${listStateToSearch(query, OVERVIEW_SCHEMA)}`;
    if (replace) window.history.replaceState(null, '', url); else window.history.pushState(null, '', url);
    sync();
    load();
  };

  async function load() {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    if (firstLoad) list.replaceChildren(skeleton({ label: 'Loading results…', lines: 4 }));
    else list.setAttribute('aria-busy', 'true');
    search.spinner.hidden = !query.q;
    try {
      const page = await api.listQuizzes({ q: query.q, sort: query.sort, page: query.page, pageSize, status: 'any', hasAttempts: true }, { signal: controller.signal });
      if (controller !== inFlight) return;
      count.textContent = page.total ? plural(page.total, 'quiz', 'quizzes') + ' with results' : '';
      if (!page.items.length) {
        paging.replaceChildren();
        list.replaceChildren(query.q
          ? emptyState({ iconName: 'searchX', title: 'No quizzes match', message: 'Try other words.', actions: [{ label: 'Clear search', variant: 'ghost', onClick: () => { search.input.value = ''; setQuery({ ...query, q: '', page: 1 }); } }] })
          : emptyState({ iconName: 'results', title: 'No results yet', message: 'Results appear here once participants take a published quiz.', actions: [{ label: 'Go to quizzes', href: 'quizzes.html', variant: 'primary' }] }));
        return;
      }
      const ul = el('ul', { class: 'results-quizzes', attrs: { 'aria-label': 'Quizzes with results' } }, page.items.map((quiz) => el('li', { class: 'results-quiz' },
        el('a', { class: 'results-quiz__link', href: `results.html?quiz=${encodeURIComponent(quiz.id)}` },
          el('span', { class: 'results-quiz__main' },
            el('span', { class: 'results-quiz__title', text: quiz.title || 'Untitled quiz' }),
            el('span', { class: 'results-quiz__meta' }, statusBadge(quiz.status), el('span', { class: 'num', text: plural(quiz.attemptCount, 'attempt') }))),
          quiz.pendingGradingCount
            ? el('span', { class: 'results-pending' }, icon('edit', { size: 14 }), el('span', { class: 'num', text: `${formatNumber(quiz.pendingGradingCount)} waiting for grading` }))
            : el('span', { class: 'results-done' }, icon('checkCircle', { size: 14 }), el('span', { text: 'All graded' })),
          icon('chevronRight', { size: 18, className: 'results-quiz__chevron' })))));
      list.replaceChildren(ul);
      if (firstLoad) stagger([...ul.children]);
      firstLoad = false;
      paging.replaceChildren(renderPagination({
        page: query.page, pageSize, total: page.total, pageSizes: CONFIG.PAGE_SIZES, noun: 'quizzes',
        hrefFor: (p) => `${window.location.pathname}${listStateToSearch({ ...query, page: p }, OVERVIEW_SCHEMA)}`,
        onPage: (p) => setQuery({ ...query, page: p }),
        onPageSize: (size) => { pageSize = size; setPref('rows', String(size)); setQuery({ ...query, page: 1 }, true); }
      }));
    } catch (error) {
      if (isAbortError(error) || handleAuth(error)) return;
      list.replaceChildren(errorState({ title: 'Results didn’t load', message: userMessage(error), onRetry: () => load() }));
    } finally {
      if (controller === inFlight) { inFlight = null; search.spinner.hidden = true; list.removeAttribute('aria-busy'); }
    }
  }

  search.input.addEventListener('input', () => {
    search.clear.hidden = !search.input.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => setQuery({ ...query, q: search.input.value.trim(), page: 1 }, true), 300);
  });
  search.clear.addEventListener('click', () => { search.input.value = ''; setQuery({ ...query, q: '', page: 1 }, true); search.input.focus(); });
  sort.select.addEventListener('change', () => setQuery({ ...query, sort: sort.select.value, page: 1 }));
  window.addEventListener('popstate', () => { query = parseListState(window.location.search, OVERVIEW_SCHEMA); sync(); load(); });
  sync();
  load();
}

// One quiz: summary and attempts --------------------------------------------------------------

/** @returns {ListState & { from: string, to: string }} */
function readQuizQuery() {
  const p = new URLSearchParams(window.location.search);
  const date = (/** @type {string | null} */ v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  return { ...parseListState(p, RESULTS_LIST_SCHEMA), from: date(p.get('from')), to: date(p.get('to')) };
}

/** @param {ListState & { from: string, to: string }} state */
function quizUrl(state) {
  const p = new URLSearchParams(listStateToSearch(state, RESULTS_LIST_SCHEMA));
  p.set('quiz', quizId);
  if (state.from) p.set('from', state.from);
  if (state.to) p.set('to', state.to);
  return `${window.location.pathname}?${p.toString()}`;
}

async function startQuiz() {
  body.replaceChildren(skeleton({ label: 'Loading results…', lines: 5 }));
  /** @type {Quiz} */
  let quiz;
  try {
    quiz = await api.getQuiz(quizId);
  } catch (error) {
    if (handleAuth(error)) return;
    titleEl.textContent = 'Results';
    body.replaceChildren(error instanceof ApiError && error.status === 404
      ? emptyState({ iconName: 'searchX', title: 'We can’t find that quiz', message: 'It may have been deleted, or the link may be incomplete.', actions: [{ label: 'Back to Results', href: 'results.html', variant: 'primary' }] })
      : errorState({ title: 'Results didn’t load', message: userMessage(error), onRetry: startQuiz }));
    return;
  }
  const title = quiz.title || 'Untitled quiz';
  titleEl.textContent = title;
  document.title = `Results: ${title} · JCI Uniben Quiz Admin`;
  const topbar = qs('.topbar__title');
  if (topbar) topbar.textContent = 'Results';
  descEl.textContent = `${plural(quiz.questions.length, 'question')} · ${plural(quiz.questions.reduce((s, q) => s + q.marks, 0), 'mark')} in total`;
  crumbs.hidden = false;
  crumbTitle.textContent = title;
  badgesEl.replaceChildren(statusBadge(quiz.status));

  let query = readQuizQuery();
  const summaryHost = el('section', { class: 'results-summary', attrs: { 'aria-label': 'Summary' } });
  const search = searchField('attempt-search', 'Search participants', 'Search by name or email');
  const status = selectField('attempt-status', 'Status', 'checkCircle', [['', 'All statuses'], ...Object.entries(ATTEMPT_STATUS_META).map(([v, m]) => /** @type {[string, string]} */ ([v, m.label]))]);
  const sort = selectField('attempt-sort', 'Sort by', 'arrowUpDown', ATTEMPT_SORTS.map(([v, l]) => /** @type {[string, string]} */ ([v, `Sort: ${l}`])));
  const from = el('input', { class: 'input', type: 'date', id: 'attempt-from' });
  const to = el('input', { class: 'input', type: 'date', id: 'attempt-to' });
  const dates = el('fieldset', { class: 'results-dates' },
    el('legend', { class: 'sr-only', text: 'Submitted between' }),
    el('label', { class: 'results-dates__label', for: 'attempt-from', text: 'From' }), from,
    el('label', { class: 'results-dates__label', for: 'attempt-to', text: 'To' }), to);
  const count = el('p', { class: 'list-meta__count num', attrs: { 'aria-live': 'polite' } });
  const clearButton = el('button', { type: 'button', class: 'btn btn--small btn--ghost', hidden: true },
    el('span', { class: 'btn__label', text: 'Clear filters' }));
  const list = el('div', { class: 'list-body results-list' });
  const paging = el('div', { class: 'list-footer' });
  body.replaceChildren(summaryHost, el('section', { class: 'list-panel', attrs: { 'aria-label': 'Attempts' } },
    el('div', { class: 'list-toolbar' },
      el('div', { class: 'list-toolbar__row results-toolbar' }, search.element, status.element, sort.element),
      dates),
    el('div', { class: 'list-meta' }, count, clearButton),
    list,
    paging));

  loadSummary(quiz);

  const sync = () => {
    if (document.activeElement !== search.input) search.input.value = query.q;
    search.clear.hidden = !search.input.value;
    status.select.value = query.filters.status;
    sort.select.value = query.sort;
    from.value = query.from;
    to.value = query.to;
    clearButton.hidden = !(isFiltered(query) || query.from || query.to);
  };
  /** @param {ListState & { from: string, to: string }} next @param {boolean} [replace] */
  const setQuery = (next, replace = false) => {
    query = next;
    if (replace) window.history.replaceState(null, '', quizUrl(query)); else window.history.pushState(null, '', quizUrl(query));
    sync();
    load();
  };

  async function load() {
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;
    if (firstLoad) list.replaceChildren(skeleton({ label: 'Loading attempts…', lines: 6 }));
    else list.setAttribute('aria-busy', 'true');
    search.spinner.hidden = !query.q;
    try {
      const page = await api.listAttempts(quizId, { q: query.q, status: query.filters.status, from: query.from, to: query.to, sort: query.sort, page: query.page, pageSize }, { signal: controller.signal });
      if (controller !== inFlight) return;
      count.textContent = page.total ? plural(page.total, 'attempt') : '';
      if (!page.items.length) {
        paging.replaceChildren();
        const filtered = isFiltered(query) || query.from || query.to;
        list.replaceChildren(filtered
          ? emptyState({ iconName: 'searchX', title: 'No attempts match', message: 'Try other words, statuses or dates.', actions: [{ label: 'Clear filters', variant: 'ghost', onClick: clearAll }] })
          : emptyState({ iconName: 'users', title: 'No attempts yet', message: quiz.status === 'published' ? 'Attempts appear here as participants take the quiz.' : 'Participants can take this quiz once it’s published.' }));
        return;
      }
      list.replaceChildren(attemptsTable(page.items, quiz));
      firstLoad = false;
      paging.replaceChildren(renderPagination({
        page: query.page, pageSize, total: page.total, pageSizes: CONFIG.PAGE_SIZES, noun: 'attempts',
        hrefFor: (p) => quizUrl({ ...query, page: p }),
        onPage: (p) => setQuery({ ...query, page: p }),
        onPageSize: (size) => { pageSize = size; setPref('rows', String(size)); setQuery({ ...query, page: 1 }, true); }
      }));
    } catch (error) {
      if (isAbortError(error) || handleAuth(error)) return;
      paging.replaceChildren();
      list.replaceChildren(errorState({ title: 'Attempts didn’t load', message: userMessage(error), onRetry: () => load() }));
    } finally {
      if (controller === inFlight) { inFlight = null; search.spinner.hidden = true; list.removeAttribute('aria-busy'); }
    }
  }

  function clearAll() {
    search.input.value = '';
    setQuery({ ...clearFilters(query), from: '', to: '' });
  }

  search.input.addEventListener('input', () => {
    search.clear.hidden = !search.input.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => setQuery({ ...query, q: search.input.value.trim(), page: 1 }, true), 300);
  });
  search.clear.addEventListener('click', () => { search.input.value = ''; setQuery({ ...query, q: '', page: 1 }, true); search.input.focus(); });
  status.select.addEventListener('change', () => setQuery({ ...query, filters: { status: status.select.value }, page: 1 }));
  sort.select.addEventListener('change', () => setQuery({ ...query, sort: sort.select.value, page: 1 }));
  from.addEventListener('change', () => setQuery({ ...query, from: from.value, page: 1 }));
  to.addEventListener('change', () => setQuery({ ...query, to: to.value, page: 1 }));
  clearButton.addEventListener('click', clearAll);
  window.addEventListener('popstate', () => { query = readQuizQuery(); sync(); load(); });
  sync();
  load();
}

/** The summary strip and the "Grade next" button. @param {Quiz} quiz */
async function loadSummary(quiz) {
  const host = /** @type {HTMLElement} */ (qs('.results-summary'));
  actionsEl.replaceChildren(el('a', { class: 'btn', href: `quiz-edit.html?id=${encodeURIComponent(quiz.id)}` }, icon('edit', { size: 18 }), el('span', { class: 'btn__label', text: 'Open quiz' })));
  try {
    const summary = await api.getResultsSummary(quiz.id);
    /** @param {string} label @param {string} value @param {string} [tone] */
    const tile = (label, value, tone = '') => el('div', { class: ['results-stat', tone] }, el('dt', { text: label }), el('dd', { class: 'num', text: value }));
    const pct = (/** @type {number | null} */ v) => (v === null ? '—' : `${formatNumber(v)}%`);
    host.replaceChildren(el('dl', { class: 'results-stats' },
      tile('Attempts', formatNumber(summary.attempts)),
      tile('Average', pct(summary.averagePercent)),
      tile('Highest', pct(summary.highestPercent)),
      tile('Lowest', pct(summary.lowestPercent)),
      tile('Waiting for grading', formatNumber(summary.pendingGrading), summary.pendingGrading ? 'is-waiting' : '')));
    host.classList.add('fade-in');
    if (summary.pendingGrading) {
      const first = await api.listAttempts(quiz.id, { status: 'pending_grading', sort: 'submittedAt:asc', pageSize: 1 });
      if (first.items[0]) {
        actionsEl.prepend(el('a', { class: 'btn btn--primary', href: `attempt.html?id=${encodeURIComponent(first.items[0].id)}`, data: { gradeNext: '' } },
          icon('edit', { size: 18 }), el('span', { class: 'btn__label', text: `Grade next (${formatNumber(summary.pendingGrading)} waiting)` })));
      }
    }
  } catch (error) {
    if (handleAuth(error)) return;
    host.replaceChildren();   // the summary is optional: the table still works without it
  }
}

/**
 * @param {AttemptSummary[]} items
 * @param {Quiz} quiz
 */
function attemptsTable(items, quiz) {
  const several = quiz.settings.maxAttempts === null || quiz.settings.maxAttempts > 1;
  const head = ['Participant', 'Attempt', 'Submitted', 'Time taken', 'Score', '%', 'Status'];
  return el('table', { class: 'results-table' },
    el('caption', { class: 'sr-only', text: `Attempts at ${quiz.title || 'this quiz'}` }),
    el('thead', {}, el('tr', {}, head.map((h, i) => el('th', { attrs: { scope: 'col' }, class: i >= 4 && i <= 5 ? 'is-number' : '', text: h })))),
    el('tbody', {}, items.map((a) => {
      const pct = percentOf(a.score, a.maxScore);
      const href = `attempt.html?id=${encodeURIComponent(a.id)}`;
      const row = el('tr', { class: ['results-row', a.status === 'pending_grading' ? 'is-waiting' : ''], data: { id: a.id } },
        el('th', { attrs: { scope: 'row' }, class: 'results-row__who' },
          el('a', { class: 'results-row__name', href, text: a.participant.name }),
          el('span', { class: 'results-row__email', text: a.participant.email })),
        el('td', { data: { label: 'Attempt' }, class: 'num' }, `#${a.attemptNumber}`, several && a.isFinal ? el('span', { class: 'results-counts', attrs: { title: 'This attempt counts toward the result' }, text: 'Counts' }) : null),
        el('td', { data: { label: 'Submitted' }, attrs: { title: a.submittedAt ? formatDateTime(a.submittedAt) : '' }, text: a.submittedAt ? formatRelative(a.submittedAt) : 'Not yet' }),
        el('td', { data: { label: 'Time taken' }, class: 'num', text: timeTaken(a.startedAt, a.submittedAt) || '—' }),
        el('td', { data: { label: 'Score' }, class: 'num is-number', text: scoreText(a.score, a.maxScore) }),
        el('td', { data: { label: '%' }, class: 'num is-number', text: pct === null ? '—' : `${formatNumber(pct)}%` }),
        el('td', { data: { label: 'Status' } }, attemptBadge(a.status)));
      // The whole row opens the attempt; the name stays the real link for keyboards and screen readers.
      row.addEventListener('click', (event) => {
        if (/** @type {HTMLElement} */ (event.target).closest('a')) return;
        window.location.href = href;
      });
      return row;
    })));
}
