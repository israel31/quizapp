// @ts-check
/**
 * Dashboard (dashboard.html, section 11). Built last so every number comes
 * from the API (GET /admin/dashboard/summary), never placeholders:
 * - quick actions: Create quiz, View all quizzes, Open results;
 * - four summary cards, each linking to the matching list;
 * - Needs attention: answers waiting for grading, quizzes closing or opening soon;
 * - recently updated quizzes and recent submissions.
 * While loading it shows skeletons the same size as the content. If something
 * isn't available it says so. Numbers count up once (not with reduced motion).
 */
import { api } from '../api/index.js';
import { ApiError, userMessage } from '../api/client.js';
import { el, qs, qsa } from '../core/dom.js';
import { icon } from '../icons.js';
import { formatDateTime, formatNumber, formatRelative, plural } from '../core/format.js';
import { redirectToLogin } from '../core/session.js';
import { countUp, stagger } from '../core/motion.js';
import { takeFlash } from '../core/flash.js';
import { bootPage } from '../components/shell.js';
import { errorState } from '../components/states.js';
import { statusBadge, attemptBadge } from '../components/badge.js';
import { toast } from '../components/toast.js';
import { newQuizDialog, editorUrl } from '../quiz/quiz-actions.js';
import { percentOf, scoreText } from '../quiz/results-rules.js';

/** @typedef {import('../types.js').DashboardSummary} DashboardSummary */
/** @typedef {import('../types.js').AttentionQuiz} AttentionQuiz */

const body = /** @type {HTMLElement} */ (qs('[data-dashboard]'));
/** How many quizzes waiting for grading are listed by name. */
const PENDING_SHOWN = 3;

bootPage({
  page: 'dashboard',
  title: 'Dashboard',
  onReady: () => {
    qsa('[data-new-quiz]').forEach((button) => {
      button.hidden = false;
      button.addEventListener('click', () => newQuizDialog());
    });
    const flash = takeFlash();
    if (flash) toast(flash);
    load();
  }
});

async function load() {
  body.replaceChildren(loadingShape());
  body.setAttribute('aria-busy', 'true');
  try {
    render(await api.getDashboardSummary());
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    body.replaceChildren(errorState({
      title: 'The dashboard didn’t load',
      message: `${userMessage(error)} The quick actions above still work.`,
      onRetry: load
    }));
  } finally {
    body.removeAttribute('aria-busy');
  }
}

/** Skeletons shaped like the real content, so nothing jumps when it arrives. */
function loadingShape() {
  const block = (/** @type {string} */ cls) => el('div', { class: ['skeleton', cls], attrs: { 'aria-hidden': 'true' } });
  return el('div', { class: 'dash', attrs: { role: 'status' } },
    el('span', { class: 'sr-only', text: 'Loading the dashboard…' }),
    el('div', { class: 'dash-stats' }, [1, 2, 3, 4].map(() => block('dash-skeleton--stat'))),
    block('dash-skeleton--panel'),
    el('div', { class: 'dash-columns' }, block('dash-skeleton--panel'), block('dash-skeleton--panel')));
}

/** @param {DashboardSummary} data */
function render(data) {
  const stats = statCards(data);
  const recent = el('div', { class: 'dash-columns' }, recentQuizzes(data), recentSubmissions(data));
  body.replaceChildren(el('div', { class: 'dash fade-in' }, stats, needsAttention(data), recent));
  qsa('[data-count]', stats).forEach((node) => countUp(node, Number(node.dataset.count), { format: formatNumber }));
  stagger(qsa('.dash-list > li', body));
}

// Summary cards -----------------------------------------------------------------------

/** @param {DashboardSummary} data */
function statCards({ totals }) {
  /**
   * @param {string} label @param {number} value @param {string} href @param {string} iconName @param {string} hint
   * @param {string} id
   */
  const card = (label, value, href, iconName, hint, id) => el('a', { class: 'dash-stat', href, data: { stat: id }, attrs: { 'aria-describedby': `${id}-hint` } },
    el('span', { class: 'dash-stat__icon' }, icon(iconName, { size: 18 })),
    el('span', { class: 'dash-stat__label', text: label }),
    el('span', { class: 'dash-stat__value num', data: { count: String(value) }, text: formatNumber(value) }),
    el('span', { class: 'dash-stat__hint', id: `${id}-hint`, text: hint }));
  return el('section', { class: 'dash-section', attrs: { 'aria-labelledby': 'dash-stats-heading' } },
    el('h2', { class: 'sr-only', id: 'dash-stats-heading', text: 'At a glance' }),
    el('div', { class: 'dash-stats' },
      card('Quizzes', totals.quizzes, 'quizzes.html', 'quizzes', totals.archived ? `Drafts and published · ${formatNumber(totals.archived)} archived` : 'Drafts and published', 'stat-quizzes'),
      card('Published', totals.published, 'quizzes.html?status=published', 'checkCircle', 'Participants can see these', 'stat-published'),
      card('Drafts', totals.drafts, 'quizzes.html?status=draft', 'edit', 'Private until published', 'stat-drafts'),
      card('Attempts', totals.attempts, 'results.html', 'users', 'By participants, across all quizzes', 'stat-attempts')));
}

// Needs attention ---------------------------------------------------------------------

/** @param {DashboardSummary} data */
function needsAttention({ pendingGrading, closingSoon, openingSoon }) {
  const heading = el('h2', { class: 'card-title', id: 'dash-attention-heading', text: 'Needs attention' });
  const section = el('section', { class: 'card dash-panel', data: { attention: '' }, attrs: { 'aria-labelledby': 'dash-attention-heading' } }, heading);
  if (!pendingGrading && !closingSoon && !openingSoon) {
    section.append(el('p', { class: 'dash-note', text: 'This isn’t available from the server yet.' }));
    return section;
  }
  /** @type {HTMLElement[]} */
  const items = [];
  if (pendingGrading && pendingGrading.attempts > 0) {
    const shown = pendingGrading.quizzes.slice(0, PENDING_SHOWN);
    const more = pendingGrading.quizzes.length - shown.length;
    items.push(el('li', { class: 'dash-alert dash-alert--waiting', data: { alert: 'grading' } },
      el('span', { class: 'dash-alert__icon' }, icon('edit', { size: 18 })),
      el('div', { class: 'dash-alert__body' },
        el('p', { class: 'dash-alert__title num', text: `${plural(pendingGrading.attempts, 'attempt')} waiting for grading` }),
        el('ul', { class: 'dash-alert__links' }, shown.map((quiz) => el('li', {},
          el('a', { href: `results.html?quiz=${encodeURIComponent(quiz.id)}&status=pending_grading`, text: quiz.title || 'Untitled quiz' }),
          el('span', { class: 'num', text: ` · ${formatNumber(quiz.count)}` })))),
        more > 0 ? el('a', { class: 'dash-alert__more', href: 'results.html', text: `and ${plural(more, 'more quiz', 'more quizzes')} in Results` }) : null)));
  }
  for (const quiz of closingSoon || []) items.push(timeAlert(quiz, 'closing'));
  for (const quiz of openingSoon || []) items.push(timeAlert(quiz, 'opening'));

  if (!items.length) {
    section.append(el('p', { class: 'dash-calm' }, icon('checkCircle', { size: 18 }), el('span', { text: 'Nothing needs your attention right now.' })));
  } else {
    section.append(el('ul', { class: 'dash-alerts' }, items));
  }
  return section;
}

/** @param {AttentionQuiz} quiz @param {'closing' | 'opening'} kind */
function timeAlert(quiz, kind) {
  const when = quiz.at ? formatRelative(quiz.at) : 'soon';
  return el('li', { class: ['dash-alert', kind === 'closing' ? 'dash-alert--soon' : 'dash-alert--info'], data: { alert: kind } },
    el('span', { class: 'dash-alert__icon' }, icon(kind === 'closing' ? 'clock' : 'calendar', { size: 18 })),
    el('div', { class: 'dash-alert__body' },
      el('p', { class: 'dash-alert__title' },
        el('a', { href: editorUrl(quiz.id), text: quiz.title || 'Untitled quiz' }),
        ` ${kind === 'closing' ? 'closes' : 'opens'} ${when}`),
      quiz.at ? el('p', { class: 'dash-alert__detail', text: formatDateTime(quiz.at) }) : null));
}

// Recent lists ------------------------------------------------------------------------

/** @param {DashboardSummary} data */
function recentQuizzes({ recentQuizzes: quizzes }) {
  const section = panel('dash-recent-heading', 'Recently updated quizzes', { href: 'quizzes.html', label: 'View all quizzes' });
  if (!quizzes.length) {
    section.insertBefore(el('p', { class: 'dash-note', text: 'No quizzes yet. Create one to get started.' }), section.lastChild);
    return section;
  }
  section.insertBefore(el('ul', { class: 'dash-list', data: { recentQuizzes: '' } }, quizzes.map((quiz) => el('li', { class: 'dash-row' },
    el('div', { class: 'dash-row__main' },
      el('a', { class: ['dash-row__title', quiz.title.trim() ? '' : 'is-untitled'], href: editorUrl(quiz.id), text: quiz.title.trim() || 'Untitled quiz' }),
      el('span', { class: 'dash-row__meta', attrs: { title: formatDateTime(quiz.updatedAt) }, text: `Updated ${formatRelative(quiz.updatedAt)}` })),
    statusBadge(quiz.status)))), section.lastChild);
  return section;
}

/** @param {DashboardSummary} data */
function recentSubmissions({ recentSubmissions: submissions }) {
  const section = panel('dash-submissions-heading', 'Recent submissions', { href: 'results.html', label: 'Open results' });
  if (submissions === null) {
    section.insertBefore(el('p', { class: 'dash-note', text: 'Recent submissions aren’t available from the server yet. Results has every attempt.' }), section.lastChild);
    return section;
  }
  if (!submissions.length) {
    section.insertBefore(el('p', { class: 'dash-note', text: 'No submissions yet. They appear here once participants submit a quiz.' }), section.lastChild);
    return section;
  }
  section.insertBefore(el('ul', { class: 'dash-list', data: { recentSubmissions: '' } }, submissions.map((item) => {
    const pct = percentOf(item.score, item.maxScore);
    return el('li', { class: 'dash-row' },
      el('div', { class: 'dash-row__main' },
        el('a', { class: 'dash-row__title', href: `attempt.html?id=${encodeURIComponent(item.attemptId)}`, text: item.participant.name }),
        el('span', { class: 'dash-row__meta' },
          el('span', { text: item.quizTitle || 'Untitled quiz' }),
          el('span', { attrs: { title: formatDateTime(item.submittedAt) }, text: ` · ${formatRelative(item.submittedAt)}` }))),
      el('div', { class: 'dash-row__side' },
        el('span', { class: 'dash-row__score num', text: `${scoreText(item.score, item.maxScore)}${pct === null ? '' : ` · ${formatNumber(pct)}%`}` }),
        attemptBadge(item.status)));
  })), section.lastChild);
  return section;
}

/**
 * A titled card with a link at the bottom.
 * @param {string} id @param {string} title @param {{ href: string, label: string }} link
 */
function panel(id, title, link) {
  return el('section', { class: 'card dash-panel', attrs: { 'aria-labelledby': id } },
    el('h2', { class: 'card-title', id, text: title }),
    el('a', { class: 'dash-panel__link', href: link.href }, el('span', { text: link.label }), icon('chevronRight', { size: 16 })));
}
