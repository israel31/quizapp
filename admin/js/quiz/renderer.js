// @ts-check
/**
 * Renders a quiz the way participants see it (section 22), in the quiz's OWN
 * appearance — never the admin site's Dark/Light theme. Used by the question
 * builder's canvas, the appearance sample and the Preview page.
 *
 * SHAREABLE with the participant-section developer, together with appearance.js and
 * css/quiz-render.css: it depends on nothing else, builds every element with
 * createElement, and sets all text with textContent (never as HTML).
 *
 * Admin-only data (correct options, accepted answers, grading notes) is only
 * drawn when `showCorrect` is on — the admin's "Show correct answers" overlay.
 * The participant API must never send that data to participants in the first place.
 */
import { resolveAppearance, appearanceVars, sanitizeAppearance } from './appearance.js';

/** @typedef {import('./appearance.js').Appearance} Appearance */
/**
 * The question fields the renderer reads (the admin model in js/types.js).
 * @typedef {{
 *   id: string, type: string, text: string, explanation?: string | null, marks: number,
 *   image?: { url: string, alt: string, decorative: boolean, placement?: string, size?: string } | null,
 *   options?: { id: string, text: string, isCorrect?: boolean, image?: { url: string, alt: string, decorative: boolean } | null }[],
 *   acceptedAnswers?: string[], caseSensitive?: boolean, maxLength?: number | null, gradingNotes?: string,
 *   appearance?: Partial<Appearance>
 * }} RenderQuestion
 */
/** @typedef {{ selected: string[], text: string }} Answer */

/** What participants are told under each question. */
export const PARTICIPANT_HINTS = Object.freeze({
  multiple_choice: 'Choose one answer',
  checkboxes: 'Select all that apply',
  short_answer: 'Type a short answer',
  paragraph: 'Write your answer'
});

/** A question for the appearance sample when a quiz has none yet. */
export const SAMPLE_QUESTION = Object.freeze(/** @type {RenderQuestion} */ ({
  id: 'sample',
  type: 'multiple_choice',
  text: 'What does JCI stand for?',
  marks: 1,
  image: null,
  options: [
    { id: 'sample-a', text: 'Junior Chamber International', isCorrect: true, image: null },
    { id: 'sample-b', text: 'Joint Council of Innovators', isCorrect: false, image: null },
    { id: 'sample-c', text: 'Junior Citizens Institute', isCorrect: false, image: null }
  ],
  appearance: {}
}));

let counter = 0;

/**
 * A tiny element helper: text is always set as text.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {{ class?: string, text?: string, attrs?: Record<string, string | null | undefined> }} [props]
 * @param {(Node | null | false | undefined)[]} [children]
 * @returns {HTMLElementTagNameMap[K]}
 */
function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs || {})) {
    if (value !== null && value !== undefined) node.setAttribute(name, value);
  }
  for (const child of children) if (child) node.appendChild(child);
  return node;
}

/** A check mark (decorative). */
function checkIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M20 6 9 17l-5-5');
  svg.appendChild(path);
  return svg;
}

/** @param {HTMLElement} node @param {Record<string, string>} vars */
function setVars(node, vars) {
  for (const [name, value] of Object.entries(vars)) node.style.setProperty(name, value);
}

/** @param {number} marks */
const marksText = (marks) => `${marks} mark${marks === 1 ? '' : 's'}`;

/** @param {{ url: string, alt: string, decorative: boolean } | null | undefined} image @param {string} className */
function picture(image, className) {
  if (!image || !image.url) return null;
  return h('img', { class: className, attrs: { src: image.url, alt: image.decorative ? '' : image.alt, decoding: 'async', loading: 'lazy' } });
}

/**
 * One question card.
 * @param {RenderQuestion} question
 * @param {Partial<Appearance>} quizAppearance
 * @param {{
 *   number?: number, total?: number,
 *   showMeta?: boolean,
 *   interactive?: boolean,
 *   showCorrect?: boolean,
 *   answer?: Answer,
 *   onAnswer?: (answer: Answer) => void
 * }} [options]
 * @returns {HTMLElement}
 */
export function renderQuestion(question, quizAppearance, options = {}) {
  const { number, total, showMeta = true, interactive = false, showCorrect = false, onAnswer } = options;
  const answer = options.answer || { selected: [], text: '' };
  const look = resolveAppearance(quizAppearance, question.appearance);
  const uid = `qr${++counter}`;
  const textId = `${uid}-text`;
  const hintId = `${uid}-hint`;

  const card = h('article', { class: 'qr-card qr-question', attrs: { 'aria-labelledby': textId, 'data-question-id': question.id, tabindex: interactive ? '-1' : null } });
  setVars(card, appearanceVars(look));

  const meta = !showMeta ? null : h('p', { class: 'qr-card__meta' }, [
    number ? h('span', { text: total ? `Question ${number} of ${total}` : `Question ${number}` }) : null,
    h('span', { class: 'qr-card__marks', text: marksText(question.marks) })
  ]);

  const text = question.text.trim();
  const textEl = h('p', { class: `qr-card__text${text ? '' : ' is-missing'}`, attrs: { id: textId }, text: text || 'No question text yet' });
  const hint = h('p', { class: 'qr-card__hint', attrs: { id: hintId }, text: /** @type {Record<string, string>} */ (PARTICIPANT_HINTS)[question.type] || '' });

  const image = question.image && question.image.url ? question.image : null;
  const placement = image?.placement === 'below' || image?.placement === 'beside' ? image.placement : 'above';
  const figure = image ? h('figure', { class: `qr-figure qr-figure--${image.size === 'small' || image.size === 'full' ? image.size : 'medium'}` }, [picture(image, 'qr-figure__img')]) : null;

  const answers = answerArea(question, { uid, textId, hintId, interactive, showCorrect, answer, onAnswer });

  const main = h('div', { class: 'qr-card__main' }, [
    placement === 'above' ? figure : null,
    textEl,
    placement === 'below' ? figure : null,
    hint,
    answers
  ]);
  if (meta) card.append(meta);
  card.append(placement === 'beside' && figure
    ? h('div', { class: 'qr-card__beside' }, [main, figure])
    : main);

  if (showCorrect && question.explanation && question.explanation.trim()) {
    card.append(h('div', { class: 'qr-key qr-key--explanation' }, [
      h('strong', { text: 'Explanation: ' }), h('span', { text: question.explanation.trim() })
    ]));
  }
  return card;
}

/**
 * @param {RenderQuestion} question
 * @param {{ uid: string, textId: string, hintId: string, interactive: boolean, showCorrect: boolean, answer: Answer, onAnswer?: (a: Answer) => void }} ctx
 */
function answerArea(question, ctx) {
  const { uid, textId, hintId, interactive, showCorrect, answer, onAnswer } = ctx;
  if (question.type === 'multiple_choice' || question.type === 'checkboxes') {
    const multi = question.type === 'checkboxes';
    const group = h('div', { class: 'qr-options', attrs: interactive ? { role: multi ? 'group' : 'radiogroup', 'aria-labelledby': textId, 'aria-describedby': hintId } : {} });
    (question.options || []).forEach((option) => {
      const correct = showCorrect && Boolean(option.isCorrect);
      const label = option.text.trim();
      const children = [];
      if (interactive) {
        const input = h('input', { class: 'qr-option__input', attrs: { type: multi ? 'checkbox' : 'radio', name: uid, value: option.id } });
        input.checked = answer.selected.includes(option.id);
        input.addEventListener('change', () => {
          const selected = multi
            ? [...group.querySelectorAll('input:checked')].map((node) => /** @type {HTMLInputElement} */ (node).value)
            : [option.id];
          answer.selected = selected;
          group.querySelectorAll('.qr-option').forEach((row) => row.classList.toggle('is-selected', Boolean(row.querySelector('input:checked'))));
          onAnswer?.(answer);
        });
        children.push(input);
      } else {
        children.push(h('span', { class: `qr-option__mark${multi ? ' is-square' : ''}`, attrs: { 'aria-hidden': 'true' } }));
      }
      children.push(picture(option.image, 'qr-option__img'));
      children.push(h('span', { class: `qr-option__text${label ? '' : ' is-missing'}`, text: label || 'Empty option' }));
      if (correct) children.push(h('span', { class: 'qr-badge' }, [checkIcon(), h('span', { text: 'Correct' })]));
      const row = h(interactive ? 'label' : 'div', { class: `qr-option${correct ? ' is-correct' : ''}${answer.selected.includes(option.id) ? ' is-selected' : ''}` }, children);
      group.appendChild(row);
    });
    return group;
  }

  const field = h('div', { class: 'qr-field' });
  if (question.type === 'short_answer') {
    if (interactive) {
      const input = h('input', { class: 'qr-input', attrs: { type: 'text', 'aria-labelledby': textId, 'aria-describedby': hintId, autocomplete: 'off', maxlength: question.maxLength ? String(question.maxLength) : null } });
      input.value = answer.text;
      input.addEventListener('input', () => { answer.text = input.value; onAnswer?.(answer); });
      field.appendChild(input);
    } else field.appendChild(h('div', { class: 'qr-input qr-input--static', attrs: { 'aria-hidden': 'true' } }));
    if (showCorrect) {
      const accepted = question.acceptedAnswers || [];
      field.appendChild(h('div', { class: 'qr-key' }, accepted.length
        ? [h('strong', { text: 'Accepted answers: ' }), h('span', { text: `${accepted.join(' · ')}${question.caseSensitive ? ' (capital letters must match)' : ''}` })]
        : [h('strong', { text: 'Graded by hand' }), h('span', { text: ' — no accepted answers set.' })]));
    }
  } else {
    if (interactive) {
      const area = h('textarea', { class: 'qr-input qr-input--area', attrs: { rows: '5', 'aria-labelledby': textId, 'aria-describedby': hintId, maxlength: question.maxLength ? String(question.maxLength) : null } });
      area.value = answer.text;
      area.addEventListener('input', () => { answer.text = area.value; onAnswer?.(answer); });
      field.appendChild(area);
    } else field.appendChild(h('div', { class: 'qr-input qr-input--static qr-input--area', attrs: { 'aria-hidden': 'true' } }));
    if (showCorrect) {
      field.appendChild(h('div', { class: 'qr-key' }, [
        h('strong', { text: 'Graded by hand' }),
        question.gradingNotes ? h('span', { text: ` — grading notes: ${question.gradingNotes}` }) : null
      ]));
    }
  }
  if (question.maxLength && interactive) {
    field.appendChild(h('p', { class: 'qr-card__hint', text: `Up to ${question.maxLength} characters` }));
  }
  return field;
}

/**
 * A whole quiz page: intro card, questions, and the actions at the bottom.
 * @param {{ title: string, description: string, instructions: string, appearance: Partial<Appearance>,
 *   settings?: { durationMinutes?: number | null }, questions: RenderQuestion[] }} quiz
 * @param {{
 *   interactive?: boolean, showCorrect?: boolean,
 *   layout?: 'all' | 'one',
 *   answers?: Map<string, Answer>,
 *   current?: number,
 *   onNavigate?: (index: number) => void,
 *   onSubmit?: (answers: Map<string, Answer>) => void,
 *   headingLevel?: 1 | 2
 * }} [options]
 * headingLevel: 1 on the participant page; 2 when the quiz sits inside another page (admin Preview).
 * @returns {HTMLElement}
 */
export function renderQuiz(quiz, options = {}) {
  const { interactive = true, showCorrect = false, layout = 'all', onNavigate, onSubmit, headingLevel = 1 } = options;
  const answers = options.answers || new Map();
  const look = sanitizeAppearance(quiz.appearance);
  const questions = quiz.questions || [];
  let current = Math.max(0, Math.min(options.current || 0, questions.length - 1));

  const page = h('div', { class: 'qr-page' });
  setVars(page, appearanceVars(look));
  const inner = h('div', { class: 'qr-page__inner' });
  page.appendChild(inner);

  const total = questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);
  const facts = [
    `${questions.length} question${questions.length === 1 ? '' : 's'}`,
    marksText(Math.round(total * 100) / 100),
    quiz.settings?.durationMinutes ? `Time limit: ${quiz.settings.durationMinutes} minute${quiz.settings.durationMinutes === 1 ? '' : 's'}` : 'No time limit'
  ];
  const intro = h('header', { class: 'qr-card qr-intro' }, [
    h(headingLevel === 2 ? 'h2' : 'h1', { class: 'qr-intro__title', text: quiz.title.trim() || 'Untitled quiz' }),
    quiz.description.trim() ? h('p', { class: 'qr-intro__description', text: quiz.description.trim() }) : null,
    h('ul', { class: 'qr-intro__facts' }, facts.map((fact) => h('li', { text: fact }))),
    quiz.instructions.trim() ? h('div', { class: 'qr-intro__instructions' }, [
      h('p', { class: 'qr-intro__label', text: 'Instructions' }),
      h('p', { class: 'qr-intro__text', text: quiz.instructions.trim() })
    ]) : null
  ]);
  setVars(intro, appearanceVars(look));
  inner.appendChild(intro);

  if (!questions.length) {
    inner.appendChild(h('p', { class: 'qr-card qr-empty', text: 'This quiz has no questions yet.' }));
    return page;
  }

  const answerFor = (/** @type {RenderQuestion} */ q) => {
    if (!answers.has(q.id)) answers.set(q.id, { selected: [], text: '' });
    return /** @type {Answer} */ (answers.get(q.id));
  };
  const card = (/** @type {RenderQuestion} */ q, /** @type {number} */ index) =>
    renderQuestion(q, look, { number: index + 1, total: questions.length, interactive, showCorrect, answer: answerFor(q) });

  const list = h('div', { class: 'qr-questions' });
  const progress = h('div', { class: 'qr-progress', attrs: { 'aria-live': 'polite' } });
  const actions = h('div', { class: 'qr-actions' });
  inner.append(progress, list, actions);

  const button = (/** @type {string} */ text, /** @type {string} */ kind, /** @type {() => void} */ run, disabled = false) => {
    const node = h('button', { class: `qr-button qr-button--${kind}`, text, attrs: { type: 'button' } });
    node.disabled = disabled;
    node.addEventListener('click', run);
    return node;
  };
  const submit = () => onSubmit?.(answers);

  /** @param {boolean} [focus] */
  function draw(focus = false) {
    if (layout === 'one') {
      list.replaceChildren(card(questions[current], current));
      const pct = Math.round(((current + 1) / questions.length) * 100);
      const bar = h('div', { class: 'qr-progress__bar' });
      bar.style.setProperty('--qr-progress', `${pct}%`);
      progress.replaceChildren(
        h('span', { class: 'qr-progress__text', text: `Question ${current + 1} of ${questions.length}` }),
        h('div', { class: 'qr-progress__track', attrs: { role: 'progressbar', 'aria-label': 'Progress', 'aria-valuemin': '1', 'aria-valuemax': String(questions.length), 'aria-valuenow': String(current + 1) } }, [bar]));
      const last = current === questions.length - 1;
      actions.replaceChildren(
        button('Previous', 'ghost', () => go(current - 1), current === 0),
        last ? button('Submit quiz', 'primary', submit) : button('Next', 'primary', () => go(current + 1)));
      if (focus) /** @type {HTMLElement | null} */ (list.querySelector('.qr-question'))?.focus();
    } else {
      list.replaceChildren(...questions.map(card));
      progress.replaceChildren();
      actions.replaceChildren(button('Submit quiz', 'primary', submit));
    }
  }
  /** @param {number} index */
  function go(index) {
    current = Math.max(0, Math.min(index, questions.length - 1));
    onNavigate?.(current);
    draw(true);
  }
  draw();
  return page;
}
