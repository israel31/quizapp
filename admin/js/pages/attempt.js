// @ts-check
/**
 * One attempt (attempt.html?id=…, section 24): who took it, every answer next
 * to the correct answer (admin only), and grading for answers a person has to
 * mark (paragraphs, and short answers with no accepted answers).
 * - The total, the percentage and the status always come from the backend:
 *   saving a grade returns the updated attempt and the page shows that.
 * - Participants' answers are shown as plain text, never as HTML.
 * - Grades not saved yet are kept on the page, with a warning before leaving.
 */
import { api } from '../api/index.js';
import { ApiError, userMessage } from '../api/client.js';
import { el, qs } from '../core/dom.js';
import { icon } from '../icons.js';
import { formatDateTime, formatNumber, formatRelative, plural } from '../core/format.js';
import { redirectToLogin } from '../core/session.js';
import { announce } from '../core/a11y.js';
import { bootPage } from '../components/shell.js';
import { skeleton, emptyState, errorState } from '../components/states.js';
import { statusBadge, attemptBadge } from '../components/badge.js';
import { setButtonLoading } from '../components/button.js';
import { setFieldError, clearFieldError } from '../components/form-feedback.js';
import { toast } from '../components/toast.js';
import { signInAgain } from '../components/sign-in-dialog.js';
import { QUESTION_TYPES } from '../quiz/question-types.js';
import { timeTaken, percentOf, scoreText, gradingProgress, scoreState, parseGrade } from '../quiz/results-rules.js';

/** @typedef {import('../types.js').Attempt} Attempt */
/** @typedef {import('../types.js').Answer} Answer */
/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../types.js').Admin} Admin */

const FEEDBACK_MAX = 1000;
const attemptId = new URLSearchParams(window.location.search).get('id') || '';
const body = /** @type {HTMLElement} */ (qs('[data-attempt-body]'));
const titleEl = /** @type {HTMLElement} */ (qs('[data-attempt-title]'));
const emailEl = /** @type {HTMLElement} */ (qs('[data-attempt-email]'));
const badgesEl = /** @type {HTMLElement} */ (qs('[data-attempt-badges]'));
const navEl = /** @type {HTMLElement} */ (qs('[data-attempt-nav]'));
const crumbQuiz = /** @type {HTMLAnchorElement} */ (qs('[data-crumb-quiz]'));
const crumbTitle = /** @type {HTMLElement} */ (qs('[data-crumb-title]'));

/** @type {Attempt | null} */
let attempt = null;
/** @type {Admin | null} */
let admin = null;
/** Grading forms on the page, by question id. @type {Map<string, GradeForm>} */
const forms = new Map();
/** @type {HTMLElement | null} */
let scoreCard = null;

/**
 * @typedef {Object} GradeForm
 * @property {HTMLElement} card
 * @property {HTMLInputElement} marks
 * @property {HTMLTextAreaElement} feedback
 * @property {HTMLButtonElement} save
 * @property {HTMLElement} state
 * @property {() => boolean} isDirty
 * @property {(answer: Answer) => void} reset
 * @property {boolean} saving
 */

bootPage({
  page: 'results',
  title: 'Attempt',
  onReady: (who) => {
    admin = who;
    load();
  }
});

async function load() {
  if (!attemptId) {
    showMissing('This link doesn’t say which attempt to open.');
    return;
  }
  body.replaceChildren(skeleton({ label: 'Loading attempt…', lines: 6 }));
  try {
    render(await api.getAttempt(attemptId));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectToLogin();
      return;
    }
    if (error instanceof ApiError && error.status === 404) {
      showMissing('It may have been deleted, or the link may be incomplete.');
      return;
    }
    titleEl.textContent = 'Attempt';
    body.replaceChildren(errorState({ title: 'This attempt didn’t load', message: userMessage(error), onRetry: load }));
  }
}

/** @param {string} message */
function showMissing(message) {
  titleEl.textContent = 'Attempt not found';
  body.replaceChildren(emptyState({ iconName: 'searchX', title: 'We can’t find that attempt', message, actions: [{ label: 'Back to Results', href: 'results.html', variant: 'primary' }] }));
}

// The whole page --------------------------------------------------------------------------

/** @param {Attempt} next */
function render(next) {
  attempt = next;
  forms.clear();
  const quizTitle = next.quiz.title || 'Untitled quiz';
  titleEl.textContent = next.participant.name || 'Participant';
  emailEl.textContent = next.participant.email;
  document.title = `${next.participant.name || 'Attempt'} · ${quizTitle} · JCI Uniben Quiz Admin`;
  crumbQuiz.textContent = quizTitle;
  crumbQuiz.href = `results.html?quiz=${encodeURIComponent(next.quiz.id)}`;
  crumbTitle.textContent = `Attempt #${next.attemptNumber}`;

  const banners = el('div', { class: 'attempt__banners' });
  if (next.status === 'in_progress') {
    banners.append(el('div', { class: 'editor-banner editor-banner--info', data: { inProgress: '' }, attrs: { role: 'status' } },
      icon('clock', { size: 18, className: 'editor-banner__icon' }),
      el('div', { class: 'editor-banner__body' },
        el('p', { class: 'editor-banner__title', text: 'Still in progress' }),
        el('p', { text: 'These are the answers saved so far. Grading opens once the participant submits.' }))));
  }

  scoreCard = el('section', { class: 'card attempt-score', attrs: { 'aria-labelledby': 'attempt-score-heading' } });
  const answers = el('ol', { class: 'answer-list', attrs: { 'aria-label': 'Answers' } },
    next.questions.map((question, index) => el('li', {}, answerCard(question, index, answerFor(question.id)))));

  body.replaceChildren(el('div', { class: 'attempt' },
    banners,
    el('div', { class: 'attempt__layout' },
      el('div', { class: 'attempt__answers' },
        el('h2', { class: 'sr-only', text: 'Answers' }),
        next.questions.length ? answers : emptyState({ iconName: 'fileText', title: 'No questions', message: 'This quiz had no questions when the attempt was made.' })),
      el('aside', { class: 'attempt__aside' }, scoreCard, factsCard(next)))));
  renderScore();
}

/** @param {string} questionId */
function answerFor(questionId) {
  return attempt?.answers.find((a) => a.questionId === questionId) || null;
}

/** Header badges, prev/next, and the score card: everything the backend's total changes. */
function renderScore() {
  if (!attempt || !scoreCard) return;
  const a = attempt;
  const state = scoreState(a.status);
  badgesEl.replaceChildren(attemptBadge(a.status), statusBadge(a.quiz.status));
  renderNav();

  const pct = percentOf(a.score, a.maxScore);
  const progress = gradingProgress(a);
  /** @type {Node[]} */
  const children = [
    el('h2', { class: 'card-title', id: 'attempt-score-heading', text: state === 'final' ? 'Final score' : state === 'provisional' ? 'Score so far' : 'Score' }),
    el('p', { class: 'attempt-score__total num', data: { attemptTotal: '' } }, scoreText(a.score, a.maxScore), pct === null ? null : el('span', { class: 'attempt-score__pct', text: `${formatNumber(pct)}%` })),
    state ? el('p', { class: ['attempt-score__state', `is-${state}`] },
      icon(state === 'final' ? 'checkCircle' : 'clock', { size: 16 }),
      el('span', { text: state === 'final' ? 'Final: every answer is graded.' : 'Provisional: it can change until every answer is graded.' })) : null
  ].filter((node) => node !== null);
  if (progress.total) {
    children.push(el('div', { class: 'attempt-progress' },
      el('p', { class: 'attempt-progress__label num', data: { gradingProgress: '' }, text: `${progress.graded} of ${plural(progress.total, 'answer')} graded` }),
      el('div', { class: 'attempt-progress__track', attrs: { role: 'progressbar', 'aria-label': 'Grading progress', 'aria-valuemin': '0', 'aria-valuemax': String(progress.total), 'aria-valuenow': String(progress.graded) } },
        el('span', { class: 'attempt-progress__bar', attrs: { style: `transform:scaleX(${(progress.graded / progress.total).toFixed(3)})` } }))));
  } else if (a.status !== 'in_progress') {
    children.push(el('p', { class: 'card__description', text: 'Every answer here was marked automatically.' }));
  }
  if (a.status === 'graded' && progress.total && a.navigation.nextToGradeId) {
    children.push(el('a', { class: 'btn btn--primary attempt-score__next', href: `attempt.html?id=${encodeURIComponent(a.navigation.nextToGradeId)}` },
      el('span', { class: 'btn__label', text: 'Next attempt to grade' }), icon('chevronRight', { size: 18 })));
  }
  scoreCard.replaceChildren(...children);
}

function renderNav() {
  if (!attempt) return;
  const { previousId, nextId, nextToGradeId } = attempt.navigation;
  /** @param {string | null} id @param {string} label @param {'chevronLeft' | 'chevronRight'} iconName */
  const step = (id, label, iconName) => (id
    ? el('a', { class: 'btn btn--ghost attempt-nav__step', href: `attempt.html?id=${encodeURIComponent(id)}`, data: { attemptStep: iconName === 'chevronLeft' ? 'previous' : 'next' } },
      iconName === 'chevronLeft' ? icon(iconName, { size: 18 }) : null, el('span', { class: 'btn__label', text: label }), iconName === 'chevronRight' ? icon(iconName, { size: 18 }) : null)
    : el('span', { class: 'btn btn--ghost attempt-nav__step is-disabled', attrs: { 'aria-disabled': 'true' } },
      iconName === 'chevronLeft' ? icon(iconName, { size: 18 }) : null, el('span', { class: 'btn__label', text: label }), iconName === 'chevronRight' ? icon(iconName, { size: 18 }) : null));
  navEl.replaceChildren(step(previousId, 'Previous', 'chevronLeft'), step(nextId, 'Next', 'chevronRight'));
  if (nextToGradeId) {
    navEl.append(el('a', { class: 'btn btn--primary', href: `attempt.html?id=${encodeURIComponent(nextToGradeId)}`, data: { nextToGrade: '' } },
      icon('edit', { size: 18 }), el('span', { class: 'btn__label', text: 'Next attempt to grade' })));
  }
  navEl.hidden = false;
}

/** @param {Attempt} a */
function factsCard(a) {
  /** @param {string} label @param {string | Node} value @param {string} [title] */
  const row = (label, value, title) => el('div', { class: 'facts__row' }, el('dt', { text: label }), el('dd', { attrs: title ? { title } : {} }, value));
  return el('section', { class: 'card', attrs: { 'aria-labelledby': 'attempt-facts-heading' } },
    el('h2', { class: 'card-title', id: 'attempt-facts-heading', text: 'About this attempt' }),
    el('dl', { class: 'facts' },
      row('Quiz', el('a', { href: `results.html?quiz=${encodeURIComponent(a.quiz.id)}`, text: a.quiz.title || 'Untitled quiz' })),
      row('Attempt', `#${a.attemptNumber}`),
      row('Started', formatRelative(a.startedAt), formatDateTime(a.startedAt)),
      row('Submitted', a.submittedAt ? formatRelative(a.submittedAt) : 'Not yet', a.submittedAt ? formatDateTime(a.submittedAt) : undefined),
      row('Time taken', timeTaken(a.startedAt, a.submittedAt) || '—'),
      row('Counts toward the result', a.status === 'in_progress' ? 'Not yet' : a.isFinal ? 'Yes' : 'No, another attempt counts')));
}

// One answer ------------------------------------------------------------------------------

/**
 * @param {Question} question
 * @param {number} index
 * @param {Answer | null} answer
 */
function answerCard(question, index, answer) {
  const type = QUESTION_TYPES[question.type];
  const marksEl = el('span', { class: 'answer-card__marks num' });
  const card = el('article', { class: 'card answer-card', id: `answer-${question.id}`, data: { questionId: question.id }, attrs: { 'aria-labelledby': `answer-${question.id}-title` } },
    el('header', { class: 'answer-card__head' },
      el('h3', { class: 'answer-card__title', id: `answer-${question.id}-title` }, `Question ${index + 1}`, el('span', { class: 'sr-only', text: `, ${type.label}` })),
      el('span', { class: 'answer-card__type' }, icon(type.icon, { size: 14 }), el('span', { text: type.label })),
      marksEl),
    el('p', { class: 'answer-card__question', text: question.text || 'Untitled question' }),
    question.image?.url ? el('img', { class: 'answer-card__image', src: question.image.url, alt: question.image.decorative ? '' : question.image.alt, attrs: { loading: 'lazy', decoding: 'async' } }) : null,
    answerBody(question, answer));
  if (question.explanation) {
    card.append(el('details', { class: 'answer-card__extra' }, el('summary', { text: 'Explanation' }), el('p', { class: 'answer-card__note', text: question.explanation })));
  }
  if (answer?.needsManualGrading && attempt?.status !== 'in_progress') card.append(gradeForm(question, answer, card));
  paintMarks(card, question, answer);
  return card;
}

/** The marks chip in a card's header. @param {HTMLElement} card @param {Question} question @param {Answer | null} answer */
function paintMarks(card, question, answer) {
  const chip = /** @type {HTMLElement} */ (card.querySelector('.answer-card__marks'));
  const of = `${formatNumber(question.marks)} mark${question.marks === 1 ? '' : 's'}`;
  let marks = null;
  if (answer) marks = answer.needsManualGrading ? answer.manualMarks : answer.autoMarks;
  chip.classList.remove('is-full', 'is-zero', 'is-part', 'is-waiting');
  if (attempt?.status === 'in_progress') {
    chip.textContent = of;
  } else if (marks === null) {
    chip.classList.add('is-waiting');
    chip.textContent = answer?.needsManualGrading ? `Not graded · ${of}` : `— / ${of}`;
  } else {
    chip.classList.add(marks >= question.marks ? 'is-full' : marks === 0 ? 'is-zero' : 'is-part');
    chip.textContent = `${formatNumber(marks)} / ${of}`;
  }
  card.classList.toggle('is-waiting', Boolean(answer?.needsManualGrading && answer.manualMarks === null && attempt?.status !== 'in_progress'));
}

/** @param {Question} question @param {Answer | null} answer */
function answerBody(question, answer) {
  if (question.type === 'multiple_choice' || question.type === 'checkboxes') return choiceAnswer(question, answer);
  const wrap = el('div', { class: 'answer-card__body' });
  const given = (answer?.text || '').trim();
  wrap.append(el('p', { class: 'answer-card__label', text: 'Their answer' }));
  wrap.append(given
    ? el('div', { class: ['answer-text', question.type === 'paragraph' ? 'answer-text--long' : ''], data: { answerText: '' }, text: answer?.text || '' })
    : el('p', { class: 'answer-empty' }, icon('info', { size: 16 }), el('span', { text: 'No answer given' })));
  if (question.type === 'paragraph' && given) {
    const words = given.split(/\s+/).filter(Boolean).length;
    wrap.append(el('p', { class: 'answer-card__note num', text: `${plural(words, 'word')} · ${plural(given.length, 'character')}` }));
  }
  if (question.type === 'short_answer') {
    const accepted = question.acceptedAnswers || [];
    wrap.append(accepted.length
      ? el('div', { class: 'answer-key' },
        el('p', { class: 'answer-card__label' }, icon('lock', { size: 14 }), el('span', { text: `Accepted answers (admin only)${question.caseSensitive ? ', capitals must match' : ''}` })),
        el('ul', { class: 'chips' }, accepted.map((text) => el('li', { class: 'chip' }, el('span', { class: 'chip__label', text })))))
      : el('p', { class: 'answer-card__note', text: 'No accepted answers were set, so a person grades this one.' }));
  }
  if (question.type === 'paragraph' && question.gradingNotes) {
    wrap.append(el('div', { class: 'answer-key' },
      el('p', { class: 'answer-card__label' }, icon('lock', { size: 14 }), el('span', { text: 'Grading notes (admin only)' })),
      el('p', { class: 'answer-card__note answer-card__note--pre', text: question.gradingNotes })));
  }
  return wrap;
}

/** Every option, marked with what they picked and which is correct. @param {Question} question @param {Answer | null} answer */
function choiceAnswer(question, answer) {
  const picked = new Set(answer?.selectedOptionIds || []);
  const options = question.options || [];
  const anyCorrect = options.some((o) => o.isCorrect);
  const multi = question.type === 'checkboxes';
  const list = el('ul', { class: 'answer-options', attrs: { 'aria-label': multi ? 'Options (they could tick several)' : 'Options (they could pick one)' } },
    options.map((option) => {
      const chose = picked.has(option.id);
      const tone = chose ? (option.isCorrect ? 'is-right' : anyCorrect ? 'is-wrong' : 'is-picked') : option.isCorrect ? 'is-key' : '';
      return el('li', { class: ['answer-option', tone], data: { picked: chose ? 'true' : 'false' } },
        el('span', { class: ['answer-option__mark', multi ? 'is-square' : ''], attrs: { 'aria-hidden': 'true' } }, chose ? icon('check', { size: 14 }) : null),
        el('span', { class: 'answer-option__text', text: option.text || 'Empty option' }),
        el('span', { class: 'answer-option__tags' },
          chose ? el('span', { class: 'answer-tag answer-tag--picked' }, icon(option.isCorrect || !anyCorrect ? 'user' : 'xCircle', { size: 14 }), el('span', { text: 'Their answer' })) : null,
          option.isCorrect ? el('span', { class: 'answer-tag answer-tag--key' }, icon('checkCircle', { size: 14 }), el('span', { text: 'Correct' })) : null));
    }));
  const wrap = el('div', { class: 'answer-card__body' }, list);
  if (!picked.size) wrap.prepend(el('p', { class: 'answer-empty' }, icon('info', { size: 16 }), el('span', { text: 'No answer given' })));
  if (!anyCorrect) wrap.append(el('p', { class: 'answer-card__note', text: 'No correct answer was marked for this question.' }));
  return wrap;
}

// Grading ---------------------------------------------------------------------------------

/**
 * Marks out of the question's marks, optional feedback, Save grade.
 * @param {Question} question
 * @param {Answer} answer
 * @param {HTMLElement} card
 */
function gradeForm(question, answer, card) {
  const base = `grade-${question.id}`;
  const marks = el('input', {
    class: 'input grade-form__marks num', id: `${base}-marks`, type: 'text', name: 'marks',
    attrs: { inputmode: 'decimal', autocomplete: 'off', 'aria-describedby': `${base}-max` }
  });
  const feedback = el('textarea', { class: 'input grade-form__textarea', id: `${base}-feedback`, name: 'feedback', rows: 3, attrs: { maxlength: String(FEEDBACK_MAX), 'aria-describedby': `${base}-count` } });
  const count = el('p', { class: 'field__hint grade-form__count num', id: `${base}-count`, attrs: { 'aria-live': 'polite' } });
  const save = el('button', { type: 'submit', class: 'btn btn--primary' }, el('span', { class: 'btn__label', text: 'Save grade' }));
  const state = el('p', { class: 'grade-form__state', attrs: { 'aria-live': 'polite' } });
  const number = (attempt?.questions || []).findIndex((q) => q.id === question.id) + 1;
  const form = el('form', { class: 'grade-form', attrs: { novalidate: true, 'aria-label': `Grade question ${number}` } },
    el('h4', { class: 'grade-form__title' }, icon('edit', { size: 16 }), el('span', { text: 'Your grade' })),
    el('div', { class: 'grade-form__row' },
      el('div', { class: 'field grade-form__marks-field' },
        el('label', { class: 'field__label', for: marks.id, text: 'Marks' }),
        el('div', { class: 'field__control grade-form__control' }, marks, el('span', { class: 'grade-form__max num', id: `${base}-max`, text: `out of ${formatNumber(question.marks)}` })),
        el('div', { class: 'field__message' }, el('div', {}))),
      el('div', { class: 'field grade-form__feedback-field' },
        el('label', { class: 'field__label', for: feedback.id }, 'Feedback ', el('span', { class: 'field__optional', text: '(optional)' })),
        el('div', { class: 'field__control' }, feedback),
        el('div', { class: 'field__message' }, el('div', {})),
        count)),
    el('div', { class: 'grade-form__actions' }, save, state));

  /** @type {{ marks: string, feedback: string }} */
  let saved = { marks: '', feedback: '' };
  const updateCount = () => { count.textContent = `${formatNumber(feedback.value.length)} / ${formatNumber(FEEDBACK_MAX)}`; };
  /** @type {GradeForm} */
  const handle = {
    card, marks, feedback, save, state, saving: false,
    isDirty: () => marks.value.trim() !== saved.marks || feedback.value.trim() !== saved.feedback,
    reset: (next) => {
      saved = { marks: next.manualMarks === null ? '' : String(next.manualMarks), feedback: next.feedback || '' };
      marks.value = saved.marks;
      feedback.value = saved.feedback;
      updateCount();
      paintState();
    }
  };
  const paintState = () => {
    const dirty = handle.isDirty();
    const graded = saved.marks !== '';
    /** @type {HTMLElement} */ (save.querySelector('.btn__label')).textContent = graded ? 'Update grade' : 'Save grade';
    state.classList.toggle('is-dirty', dirty);
    state.replaceChildren(...(dirty
      ? [icon('alertCircle', { size: 14 }), el('span', { text: 'Not saved yet' })]
      : graded ? [icon('check', { size: 14 }), el('span', { text: 'Saved' })] : []));
  };
  handle.reset(answer);
  marks.addEventListener('input', () => { clearFieldError(marks); paintState(); });
  feedback.addEventListener('input', () => { clearFieldError(feedback); updateCount(); paintState(); });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    saveGrade(question, handle);
  });
  forms.set(question.id, handle);
  return form;
}

/**
 * @param {Question} question
 * @param {GradeForm} form
 * @returns {Promise<boolean>}
 */
async function saveGrade(question, form) {
  if (!attempt || form.saving) return false;
  const parsed = parseGrade(form.marks.value, question.marks);
  const feedback = form.feedback.value.trim();
  if ('error' in parsed) {
    setFieldError(form.marks, parsed.error);
    form.marks.focus();
    return false;
  }
  clearFieldError(form.marks);
  if (feedback.length > FEEDBACK_MAX) {
    setFieldError(form.feedback, `Feedback must be ${formatNumber(FEEDBACK_MAX)} characters or fewer.`);
    form.feedback.focus();
    return false;
  }
  form.saving = true;
  setButtonLoading(form.save, true);
  try {
    const next = await api.gradeAnswer(attempt.id, question.id, { marks: parsed.value, feedback });
    applySaved(next, question.id);
    const pct = percentOf(next.score, next.maxScore);
    const total = `${scoreText(next.score, next.maxScore)}${pct === null ? '' : ` (${formatNumber(pct)}%)`}`;
    const progress = gradingProgress(next);
    const done = next.status === 'graded';
    toast({ type: 'success', message: done ? `Grade saved. All answers graded: the final score is ${total}.` : `Grade saved. Score so far: ${total}.` });
    announce(`Grade saved. ${progress.graded} of ${progress.total} answers graded.`);
    return true;
  } catch (error) {
    return handleGradeError(error, question, form);
  } finally {
    form.saving = false;
    setButtonLoading(form.save, false);
  }
}

/**
 * Take the backend's updated attempt: new total and status, and the saved
 * grade for this question. Other unsaved forms keep what was typed.
 * @param {Attempt} next
 * @param {string} questionId
 */
function applySaved(next, questionId) {
  if (!attempt) return;
  attempt = next;
  for (const question of next.questions) {
    const card = /** @type {HTMLElement | null} */ (body.querySelector(`[data-question-id="${CSS.escape(question.id)}"]`));
    if (card) paintMarks(card, question, answerFor(question.id));
  }
  const form = forms.get(questionId);
  const answer = answerFor(questionId);
  if (form && answer) form.reset(answer);
  renderScore();
}

/**
 * @param {unknown} error
 * @param {Question} question
 * @param {GradeForm} form
 */
async function handleGradeError(error, question, form) {
  if (!(error instanceof ApiError)) {
    toast({ type: 'error', message: `Couldn’t save the grade. ${userMessage(error)} Your marks are still here.` });
    return false;
  }
  if (error.status === 401) {
    const ok = await signInAgain({ identifier: admin?.email || '', reason: 'Your session ended while you were grading.' });
    if (ok) {
      form.saving = false;
      return saveGrade(question, form);
    }
    return false;
  }
  if (error.status === 422 && (error.fieldErrors.marks || error.fieldErrors.feedback)) {
    if (error.fieldErrors.feedback) setFieldError(form.feedback, error.fieldErrors.feedback);
    if (error.fieldErrors.marks) { setFieldError(form.marks, error.fieldErrors.marks); form.marks.focus(); } else form.feedback.focus();
    return false;
  }
  if (error.status === 404 && error.code === 'ATTEMPT_NOT_FOUND') {
    toast({ type: 'error', message: 'This attempt no longer exists, so the grade wasn’t saved.' });
    return false;
  }
  toast({ type: 'error', message: `Couldn’t save the grade. ${userMessage(error)}${error.status >= 500 || error.kind !== 'http' ? ' Your marks are still here; try again.' : ''}` });
  return false;
}

window.addEventListener('beforeunload', (event) => {
  if ([...forms.values()].some((form) => form.isDirty())) {
    event.preventDefault();
    event.returnValue = '';
  }
});
