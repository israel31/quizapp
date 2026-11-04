// @ts-check
/**
 * Preview (quiz-preview.html, section 22): the SAVED quiz exactly as participants
 * will see it, drawn by renderer.js in the quiz's own appearance (never the
 * admin theme). The admin can click and type answers to try it, but nothing
 * is sent anywhere. Phone / tablet / desktop widths, all questions or one at
 * a time, and an admin-only "Show correct answers" overlay.
 * The editor saves any unsaved changes before opening this page.
 */
import { api } from '../api/index.js';
import { ApiError, userMessage } from '../api/client.js';
import { qs, qsa } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { redirectToLogin } from '../core/session.js';
import { bootPage } from '../components/shell.js';
import { toast } from '../components/toast.js';
import { statusBadge } from '../components/badge.js';
import { emptyState, errorState } from '../components/states.js';
import { renderQuiz } from '../quiz/renderer.js';
import { loadFonts, resolveAppearance } from '../quiz/appearance.js';

/** @typedef {import('../types.js').Quiz} Quiz */
/** @typedef {'phone' | 'tablet' | 'desktop'} Device */

const DEVICES = /** @type {Record<Device, { label: string, width: number }>} */ ({
  phone: { label: 'Phone', width: 390 },
  tablet: { label: 'Tablet', width: 768 },
  desktop: { label: 'Desktop', width: 1100 }
});

const params = new URLSearchParams(window.location.search);
const quizId = params.get('id') || '';

const loading = /** @type {HTMLElement} */ (qs('[data-preview-loading]'));
const main = /** @type {HTMLElement} */ (qs('[data-preview-main]'));
const frame = /** @type {HTMLElement} */ (qs('[data-preview-frame]'));
const frameLabel = /** @type {HTMLElement} */ (qs('[data-frame-label]'));
const titleEl = /** @type {HTMLElement} */ (qs('[data-quiz-title]'));
const crumbQuiz = /** @type {HTMLAnchorElement} */ (qs('[data-crumb-quiz]'));
const badges = /** @type {HTMLElement} */ (qs('[data-quiz-badges]'));
const backLinks = /** @type {HTMLAnchorElement[]} */ (qsa('[data-back-to-editor]'));
const correctToggle = /** @type {HTMLInputElement} */ (qs('#preview-correct'));
const resetButton = /** @type {HTMLButtonElement} */ (qs('[data-reset-answers]'));

const state = {
  /** @type {Quiz | null} */
  quiz: null,
  /** @type {Device} */
  device: /** @type {Device} */ ((params.get('device') || '') in DEVICES ? params.get('device') : 'desktop'),
  /** @type {'all' | 'one'} */
  layout: params.get('layout') === 'one' ? 'one' : 'all',
  showCorrect: false,
  /** @type {Map<string, import('../quiz/renderer.js').Answer>} */
  answers: new Map(),
  current: 0
};

const editorUrl = `quiz-edit.html?id=${encodeURIComponent(quizId)}`;
backLinks.forEach((link) => { link.href = `${editorUrl}#questions`; });
crumbQuiz.href = editorUrl;

bootPage({ page: 'quizzes', title: 'Preview', onReady: () => load() });

async function load() {
  loading.hidden = false;
  main.hidden = true;
  if (!quizId) {
    showProblem('notFound');
    return;
  }
  try {
    show(await api.getQuiz(quizId));
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
  titleEl.textContent = kind === 'notFound' ? 'Quiz not found' : 'Preview';
  loading.replaceChildren(kind === 'notFound'
    ? emptyState({
      iconName: 'searchX',
      title: 'We can’t find that quiz',
      message: 'It may have been deleted, or the link may be incomplete.',
      actions: [{ label: 'Back to quizzes', href: 'quizzes.html', variant: 'primary' }]
    })
    : errorState({ title: 'We couldn’t load the preview', message: userMessage(error), onRetry: () => { loading.replaceChildren(); load(); } }));
}

/** @param {Quiz} quiz */
function show(quiz) {
  state.quiz = quiz;
  const title = quiz.title.trim() || 'Untitled quiz';
  titleEl.textContent = `Preview: ${title}`;
  crumbQuiz.textContent = title;
  document.title = `Preview: ${title} · JCI Uniben Quiz Admin`;
  const topbar = qs('.topbar__title');
  if (topbar) topbar.textContent = 'Preview';
  badges.replaceChildren(statusBadge(quiz.status));
  loadFonts([quiz.appearance.fontFamily, ...quiz.questions.map((q) => resolveAppearance(quiz.appearance, q.appearance).fontFamily)]);
  loading.hidden = true;
  main.hidden = false;
  main.classList.add('fade-in');
  syncControls();
  setDevice(state.device, { announceIt: false });
  draw();
}

/** @param {{ focus?: boolean }} [options] */
function draw({ focus = false } = {}) {
  const quiz = state.quiz;
  if (!quiz) return;
  frame.replaceChildren(renderQuiz(quiz, {
    interactive: true,
    headingLevel: 2,
    showCorrect: state.showCorrect,
    layout: state.layout,
    answers: state.answers,
    current: state.current,
    onNavigate: (index) => { state.current = index; },
    onSubmit: () => toast({ type: 'info', message: 'Preview only: nothing was submitted or saved.' })
  }));
  frame.classList.toggle('shows-correct', state.showCorrect);
  if (focus) /** @type {HTMLElement | null} */ (frame.querySelector('.qr-question'))?.focus();
}

/** @param {Device} device @param {{ announceIt?: boolean }} [options] */
function setDevice(device, { announceIt = true } = {}) {
  state.device = device;
  frame.dataset.device = device;
  frame.style.setProperty('--frame-width', `${DEVICES[device].width}px`);
  frameLabel.textContent = `${DEVICES[device].label} · ${DEVICES[device].width}px wide`;
  writeUrl();
  if (announceIt) announce(`Showing the ${DEVICES[device].label.toLowerCase()} width.`);
}

function writeUrl() {
  const next = new URLSearchParams({ id: quizId });
  if (state.device !== 'desktop') next.set('device', state.device);
  if (state.layout !== 'all') next.set('layout', state.layout);
  window.history.replaceState(null, '', `?${next.toString()}`);
}

function syncControls() {
  qsa('input[name="preview-device"]').forEach((input) => { /** @type {HTMLInputElement} */ (input).checked = /** @type {HTMLInputElement} */ (input).value === state.device; });
  qsa('input[name="preview-layout"]').forEach((input) => { /** @type {HTMLInputElement} */ (input).checked = /** @type {HTMLInputElement} */ (input).value === state.layout; });
  correctToggle.checked = state.showCorrect;
}

qsa('input[name="preview-device"]').forEach((input) => input.addEventListener('change', () => {
  const radio = /** @type {HTMLInputElement} */ (input);
  if (radio.checked) setDevice(/** @type {Device} */ (radio.value));
}));
qsa('input[name="preview-layout"]').forEach((input) => input.addEventListener('change', () => {
  const radio = /** @type {HTMLInputElement} */ (input);
  if (!radio.checked) return;
  state.layout = /** @type {'all' | 'one'} */ (radio.value);
  writeUrl();
  draw();
  announce(state.layout === 'one' ? 'Showing one question at a time.' : 'Showing all questions on one page.');
}));
correctToggle.addEventListener('change', () => {
  state.showCorrect = correctToggle.checked;
  draw();
  announce(state.showCorrect ? 'Correct answers shown. Only you can see this.' : 'Correct answers hidden.');
});
resetButton.addEventListener('click', () => {
  state.answers.clear();
  state.current = 0;
  draw({ focus: true });
  announce('Answers cleared.');
});

// Keep an icon in the device switch (built here so the HTML stays plain).
qsa('[data-device-icon]').forEach((slot) => slot.replaceChildren(icon(/** @type {string} */ (slot.dataset.deviceIcon), { size: 16 })));
