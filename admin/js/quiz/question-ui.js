// @ts-check
/**
 * The editor and preview UI for each question type. The type registry
 * (question-types.js) points at these; the builder calls them through it.
 * Every piece of text is set with textContent, never as HTML.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { MIN_OPTIONS, MAX_OPTIONS, MAX_ACCEPTED_ANSWERS, LIMITS, blankOption, moveItem } from './question-model.js';

/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../types.js').Option} Option */
/** @typedef {import('../types.js').QuizImage} QuizImage */
/** @typedef {import('../types.js').QuizSettings} QuizSettings */

/**
 * @typedef {Object} QuestionIssue
 * @property {string} code      text | marks | alt | options | options-max | option-empty | correct | duplicate | accepted-duplicate
 * @property {string} message
 * @property {'error' | 'warning'} level
 * @property {string} target    where it shows: text, marks, image, options, correct, accepted, option:<id>, option-image:<id>
 */

/**
 * @typedef {Object} TypeEditorContext
 * @property {() => Question} get                         the question as it is now
 * @property {(patch: Partial<Question>, options?: { rerender?: boolean, focus?: string }) => void} change
 * @property {(index: number) => void} removeOption        remove with an Undo toast
 * @property {(message: string) => void} announce
 * @property {(option: Option, index: number) => HTMLElement} optionImage   image controls for one option
 * @property {boolean} readOnly
 */

/**
 * A place for a validation message. The builder fills it (and empties it) as
 * the admin types, so messages appear without re-drawing the inputs.
 * @param {string} target  e.g. "options", "correct", "option:<id>", "accepted"
 */
export function issueSlot(target) {
  return el('div', { class: 'q-issue-slot', data: { issueFor: target } });
}

// Choice questions (multiple choice, checkboxes) -----------------------------------------

/** @param {TypeEditorContext} ctx */
export function choiceEditor(ctx) {
  const q = ctx.get();
  const multi = q.type === 'checkboxes';
  const options = q.options || [];
  const listId = `q-${q.id}-options`;

  /** Update just the markers (no re-render, so the pop animation and focus stay put). */
  const syncMarkers = () => {
    const current = ctx.get().options || [];
    list.querySelectorAll('[data-option-id]').forEach((row) => {
      const option = current.find((o) => o.id === /** @type {HTMLElement} */ (row).dataset.optionId);
      const marker = /** @type {HTMLElement} */ (row.querySelector('.correct-marker'));
      marker.setAttribute('aria-checked', String(Boolean(option?.isCorrect)));
      row.classList.toggle('is-correct', Boolean(option?.isCorrect));
    });
  };

  /** @param {string} id */
  const toggleCorrect = (id) => {
    if (ctx.readOnly) return;
    const current = ctx.get().options || [];
    const next = current.map((o) => (multi ? (o.id === id ? { ...o, isCorrect: !o.isCorrect } : o) : { ...o, isCorrect: o.id === id }));
    ctx.change({ options: next });
    syncMarkers();
    const marker = list.querySelector(`[data-option-id="${CSS.escape(id)}"] .correct-marker`);
    marker?.classList.remove('is-popping');
    void (/** @type {HTMLElement} */ (marker)?.offsetWidth);
    marker?.classList.add('is-popping');
    const index = current.findIndex((o) => o.id === id);
    const option = next[index];
    ctx.announce(multi
      ? `Option ${index + 1} ${option.isCorrect ? 'marked correct' : 'no longer marked correct'}.`
      : `Option ${index + 1} is now the correct answer.`);
  };

  /** @param {number} index @param {string} [text] */
  const addOption = (index, text = '') => {
    const current = ctx.get().options || [];
    if (current.length >= MAX_OPTIONS) {
      ctx.announce(`A question can have up to ${MAX_OPTIONS} options.`);
      return;
    }
    const option = blankOption(text);
    const next = current.slice();
    next.splice(index, 0, option);
    ctx.change({ options: next }, { rerender: true, focus: `[data-option-id="${option.id}"] .option-row__text` });
    ctx.announce(`Option ${index + 1} added.`);
  };

  /** @param {number} from @param {number} to */
  const moveOption = (from, to) => {
    const current = ctx.get().options || [];
    if (to < 0 || to >= current.length) return;
    const id = current[from].id;
    ctx.change({ options: moveItem(current, from, to) }, { rerender: true, focus: `[data-option-id="${id}"] .option-row__text` });
    ctx.announce(`Option ${from + 1} moved to position ${to + 1}.`);
  };

  const list = el('ol', { class: 'options', id: listId },
    options.map((option, index) => {
      const n = index + 1;
      const textInput = el('input', {
        class: 'input option-row__text',
        type: 'text',
        value: option.text,
        maxLength: LIMITS.option,
        readOnly: ctx.readOnly,
        attrs: { 'aria-label': `Option ${n}`, placeholder: `Option ${n}`, autocomplete: 'off' }
      });
      textInput.addEventListener('input', () => {
        const current = ctx.get().options || [];
        ctx.change({ options: current.map((o) => (o.id === option.id ? { ...o, text: textInput.value } : o)) });
      });
      textInput.addEventListener('keydown', (event) => {
        if (ctx.readOnly) return;
        const current = ctx.get().options || [];
        const at = current.findIndex((o) => o.id === option.id);
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault();
          addOption(at + 1);
        } else if (event.key === 'Backspace' && textInput.value === '' && current.length > MIN_OPTIONS && !current[at].image) {
          // An empty option: remove it and carry on typing at the end of the one above.
          event.preventDefault();
          const focusId = (current[at - 1] || current[at + 1]).id;
          ctx.change({ options: current.filter((o) => o.id !== option.id) }, { rerender: true, focus: `[data-option-id="${focusId}"] .option-row__text` });
          ctx.announce(`Option ${at + 1} removed.`);
        } else if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          moveOption(at, at + (event.key === 'ArrowUp' ? -1 : 1));
        }
      });

      const marker = el('button', {
        type: 'button',
        class: ['correct-marker', multi ? 'correct-marker--check' : 'correct-marker--radio'],
        disabled: ctx.readOnly,
        attrs: { role: multi ? 'checkbox' : 'radio', 'aria-checked': String(option.isCorrect), 'aria-label': `Option ${n} is correct` },
        on: { click: () => toggleCorrect(option.id) }
      }, multi ? icon('check', { size: 14, className: 'correct-marker__check' }) : el('span', { class: 'correct-marker__dot' }));

      const imageButton = el('button', {
        type: 'button',
        class: ['btn', 'btn--ghost', 'btn--icon', 'option-row__tool', option.image ? 'has-image' : ''],
        disabled: ctx.readOnly,
        attrs: { 'aria-label': option.image ? `Image for option ${n}` : `Add an image to option ${n}`, 'aria-expanded': option.image ? 'true' : 'false' },
        on: {
          click: () => {
            const row = /** @type {HTMLElement} */ (list.querySelector(`[data-option-id="${CSS.escape(option.id)}"]`));
            const extra = /** @type {HTMLElement} */ (row.querySelector('.option-row__extra'));
            if (extra.childElementCount && !ctx.get().options?.find((o) => o.id === option.id)?.image) {
              extra.replaceChildren();
              imageButton.setAttribute('aria-expanded', 'false');
              return;
            }
            if (!extra.childElementCount) extra.append(ctx.optionImage(option, index));
            imageButton.setAttribute('aria-expanded', 'true');
            /** @type {HTMLElement | null} */ (extra.querySelector('button, input'))?.focus();
          }
        }
      }, icon('image', { size: 18 }));

      const removeButton = el('button', {
        type: 'button',
        class: 'btn btn--ghost btn--icon option-row__tool',
        disabled: ctx.readOnly || options.length <= MIN_OPTIONS,
        attrs: { 'aria-label': `Remove option ${n}`, title: options.length <= MIN_OPTIONS ? `A question needs at least ${MIN_OPTIONS} options` : null },
        on: { click: () => ctx.removeOption(ctx.get().options?.findIndex((o) => o.id === option.id) ?? index) }
      }, icon('close', { size: 18 }));

      return el('li', { class: ['option-row', option.isCorrect ? 'is-correct' : ''], data: { optionId: option.id } },
        el('div', { class: 'option-row__main' },
          ctx.readOnly ? null : el('span', { class: 'drag-handle option-row__grip', attrs: { 'aria-hidden': 'true', title: 'Drag to reorder' } }, icon('grip', { size: 18 })),
          marker,
          textInput,
          imageButton,
          removeButton),
        el('div', { class: 'option-row__extra' }, option.image ? ctx.optionImage(option, index) : null),
        issueSlot(`option:${option.id}`));
    }));

  const full = options.length >= MAX_OPTIONS;
  return el('div', { class: 'choice-editor' },
    el('div', { class: 'choice-editor__head' },
      el('span', { class: 'field__label', text: 'Options' }),
      el('span', { class: 'choice-editor__hint', text: multi ? 'Tick every correct answer' : 'Select the one correct answer' })),
    // The group role sits on a wrapper so the options stay a real list for screen readers
    el('div', { attrs: { role: multi ? 'group' : 'radiogroup', 'aria-label': multi ? 'Options. Mark every correct answer.' : 'Options. Mark the correct answer.' } }, list),
    issueSlot('options'),
    issueSlot('correct'),
    ctx.readOnly ? null : el('div', { class: 'choice-editor__add' },
      el('button', {
        type: 'button',
        class: 'btn btn--small',
        disabled: full,
        attrs: { 'aria-describedby': `${listId}-keys` },
        on: { click: () => addOption((ctx.get().options || []).length) }
      }, icon('plus', { size: 16 }), el('span', { class: 'btn__label', text: 'Add option' })),
      el('span', { class: 'choice-editor__keys', id: `${listId}-keys`, text: full
        ? `That’s the maximum of ${MAX_OPTIONS} options.`
        : 'Enter adds an option · Backspace removes an empty one · Alt + ↑/↓ moves one' }))
  );
}

/** @param {Question} q */
export function choicePreview(q) {
  const multi = q.type === 'checkboxes';
  return el('div', { class: 'q-preview-choice' },
    multi ? el('p', { class: 'q-preview-hint', text: 'Select all that apply' }) : null,
    el('ul', { class: 'q-preview-options' }, (q.options || []).map((option) =>
      el('li', { class: ['q-preview-option', option.isCorrect ? 'is-correct' : ''] },
        el('span', { class: ['q-preview-marker', multi ? 'is-square' : ''], attrs: { 'aria-hidden': 'true' } }, option.isCorrect ? icon('check', { size: 12 }) : null),
        option.image ? el('img', { class: 'q-preview-option__img', src: option.image.url, alt: option.image.decorative ? '' : option.image.alt, attrs: { decoding: 'async', loading: 'lazy' } }) : null,
        el('span', { class: option.text.trim() ? '' : 'is-empty', text: option.text.trim() || 'Empty option' }),
        option.isCorrect ? el('span', { class: 'sr-only', text: ' (correct)' }) : null))));
}

// Short answer ----------------------------------------------------------------------------

/** @param {TypeEditorContext} ctx */
export function shortAnswerEditor(ctx) {
  const q = ctx.get();
  const answers = q.acceptedAnswers || [];
  const inputId = `q-${q.id}-accepted`;
  const input = el('input', {
    class: 'input',
    id: inputId,
    type: 'text',
    maxLength: LIMITS.accepted,
    readOnly: ctx.readOnly,
    attrs: { placeholder: 'Type an accepted answer, then press Enter', autocomplete: 'off', 'aria-describedby': `${inputId}-hint` }
  });
  const add = () => {
    const value = input.value.replace(/\s+/g, ' ').trim();
    if (!value) return;
    const current = ctx.get().acceptedAnswers || [];
    if (current.length >= MAX_ACCEPTED_ANSWERS) {
      ctx.announce(`Up to ${MAX_ACCEPTED_ANSWERS} accepted answers.`);
      return;
    }
    ctx.change({ acceptedAnswers: [...current, value] }, { rerender: true, focus: `#${inputId}` });
    ctx.announce(`Accepted answer added: ${value}.`);
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      add();
    }
  });

  const caseId = `q-${q.id}-case`;
  const caseToggle = el('input', {
    type: 'checkbox',
    class: 'switch__input',
    id: caseId,
    checked: Boolean(q.caseSensitive),
    disabled: ctx.readOnly,
    attrs: { role: 'switch' }
  });
  caseToggle.addEventListener('change', () => ctx.change({ caseSensitive: caseToggle.checked }, { rerender: true, focus: `#${caseId}` }));

  return el('div', { class: 'short-editor' },
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: inputId, text: 'Accepted answers' }),
      answers.length
        ? el('ul', { class: 'accepted-list', attrs: { 'aria-label': 'Accepted answers' } }, answers.map((answer, index) =>
          el('li', { class: 'accepted-chip' },
            el('span', { text: answer }),
            ctx.readOnly ? null : el('button', {
              type: 'button',
              class: 'accepted-chip__remove',
              attrs: { 'aria-label': `Remove accepted answer: ${answer}` },
              on: {
                click: () => {
                  const current = ctx.get().acceptedAnswers || [];
                  ctx.change({ acceptedAnswers: current.filter((_, i) => i !== index) }, { rerender: true, focus: `#${inputId}` });
                  ctx.announce(`Removed ${answer}.`);
                }
              }
            }, icon('close', { size: 14 })))))
        : null,
      ctx.readOnly ? null : el('div', { class: 'accepted-add' },
        input,
        el('button', { type: 'button', class: 'btn', on: { click: add } }, el('span', { class: 'btn__label', text: 'Add' }))),
      el('p', { class: 'field__hint', id: `${inputId}-hint`, text: 'Add every spelling or wording you’ll accept, like “UN” and “United Nations”.' }),
      issueSlot('accepted')),
    answers.length
      ? el('label', { class: 'switch', for: caseId },
        caseToggle,
        el('span', { class: 'switch__track', attrs: { 'aria-hidden': 'true' } }, el('span', { class: 'switch__thumb' })),
        el('span', { class: 'switch__label' },
          el('span', { text: 'Case sensitive' }),
          el('span', { class: 'switch__hint', text: q.caseSensitive ? 'Capital letters must match. Extra spaces are still ignored.' : 'Off: capital letters and extra spaces are ignored.' })))
      : el('p', { class: 'grading-badge' }, icon('edit', { size: 16 }), el('span', { text: 'Graded manually. With no accepted answers, a grader marks each answer by hand.' }))
  );
}

/** @param {Question} q */
export function shortAnswerPreview(q) {
  const answers = q.acceptedAnswers || [];
  return el('div', { class: 'q-preview-text' },
    el('div', { class: 'q-preview-line', attrs: { 'aria-hidden': 'true' } }),
    el('p', { class: 'q-preview-meta', text: answers.length ? `Accepted: ${answers.join(' · ')}` : 'Graded manually' }));
}

// Paragraph --------------------------------------------------------------------------------

/** @param {TypeEditorContext} ctx */
export function paragraphEditor(ctx) {
  const q = ctx.get();
  const notesId = `q-${q.id}-notes`;
  const notes = el('textarea', {
    class: 'input input--area',
    id: notesId,
    rows: 3,
    value: q.gradingNotes || '',
    maxLength: LIMITS.gradingNotes,
    readOnly: ctx.readOnly,
    attrs: { 'aria-describedby': `${notesId}-hint` }
  });
  notes.addEventListener('input', () => ctx.change({ gradingNotes: notes.value }));
  return el('div', { class: 'paragraph-editor' },
    el('p', { class: 'grading-badge' }, icon('edit', { size: 16 }),
      el('span', { text: 'Always graded manually. Scores stay provisional until a grader marks the answer.' })),
    el('div', { class: 'field' },
      el('label', { class: 'field__label', for: notesId, text: 'Grading notes (optional)' }),
      notes,
      el('p', { class: 'field__hint', id: `${notesId}-hint`, text: 'Only graders see these. They’re never sent to participants.' })));
}

/** @param {Question} q */
export function paragraphPreview(q) {
  return el('div', { class: 'q-preview-text' },
    el('div', { class: 'q-preview-box', attrs: { 'aria-hidden': 'true' } }),
    el('p', { class: 'q-preview-meta', text: q.gradingNotes ? 'Graded manually · has grading notes' : 'Graded manually' }));
}
