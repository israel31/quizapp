// @ts-check
/**
 * The question-type registry (section 14). Each type is defined once: its
 * label, icon, default data, the fields it uses, validation, how it's graded
 * (in plain words), and its editor and preview UI. The editor, the publish
 * checks, Preview and the Question Bank all read from here, so adding a type
 * later means adding one entry.
 */
import { newId, blankOption, MIN_OPTIONS, MAX_OPTIONS, MAX_ACCEPTED_ANSWERS } from './question-model.js';
import {
  choiceEditor, choicePreview, shortAnswerEditor, shortAnswerPreview, paragraphEditor, paragraphPreview
} from './question-ui.js';

/** @typedef {import('../types.js').Question} Question */
/** @typedef {import('../types.js').QuestionType} QuestionType */
/** @typedef {import('../types.js').QuizSettings} QuizSettings */
/** @typedef {import('./question-ui.js').QuestionIssue} QuestionIssue */
/** @typedef {import('./question-ui.js').TypeEditorContext} TypeEditorContext */

/**
 * @typedef {Object} QuestionTypeDefinition
 * @property {QuestionType} id
 * @property {string} label
 * @property {string} icon
 * @property {string} summary                 one line for the Add question menu
 * @property {boolean} hasOptions
 * @property {string[]} fields                type-specific fields saved with the question
 * @property {() => Partial<Question>} defaults
 * @property {(q: Question) => QuestionIssue[]} validate
 * @property {(q: Question, settings: QuizSettings) => string} gradingNote
 * @property {(q: Question) => boolean} autoGraded
 * @property {string} participantHint             what participants are told under the question
 * @property {(ctx: TypeEditorContext) => HTMLElement} editor
 * @property {(q: Question) => HTMLElement} preview
 */

/** @param {QuestionIssue[]} issues @param {Question} q */
function choiceIssues(issues, q) {
  const multi = q.type === 'checkboxes';
  const options = q.options || [];
  if (options.length < MIN_OPTIONS) issues.push({ code: 'options', message: `Add at least ${MIN_OPTIONS} options.`, level: 'error', target: 'options' });
  if (options.length > MAX_OPTIONS) issues.push({ code: 'options-max', message: `Use ${MAX_OPTIONS} options or fewer.`, level: 'error', target: 'options' });
  /** @type {Map<string, number>} */
  const seen = new Map();
  options.forEach((option, index) => {
    const text = option.text.trim().toLowerCase();
    if (!text && !option.image) issues.push({ code: 'option-empty', message: 'This option is empty. Type an answer or remove it.', level: 'error', target: `option:${option.id}` });
    if (text && seen.has(text)) {
      issues.push({ code: 'duplicate', message: `Same text as option ${/** @type {number} */ (seen.get(text)) + 1}.`, level: 'warning', target: `option:${option.id}` });
    } else if (text) seen.set(text, index);
    if (option.image && !option.image.decorative && !option.image.alt.trim()) {
      issues.push({ code: 'alt', message: 'Describe this option’s image, or mark it as decorative.', level: 'error', target: `option-image:${option.id}` });
    }
  });
  const correct = options.filter((o) => o.isCorrect).length;
  if (!multi && correct === 0) issues.push({ code: 'correct', message: 'Mark the correct answer.', level: 'error', target: 'correct' });
  if (!multi && correct > 1) issues.push({ code: 'correct', message: 'Only one option can be correct in multiple choice.', level: 'error', target: 'correct' });
  if (multi && correct === 0) issues.push({ code: 'correct', message: 'Mark at least one correct answer.', level: 'error', target: 'correct' });
}

/** @type {Record<QuestionType, QuestionTypeDefinition>} */
export const QUESTION_TYPES = {
  multiple_choice: {
    id: 'multiple_choice',
    label: 'Multiple choice',
    icon: 'radioType',
    summary: 'Participants pick one answer',
    hasOptions: true,
    fields: ['options'],
    defaults: () => ({ options: [blankOption(), blankOption()] }),
    validate: (q) => { const issues = /** @type {QuestionIssue[]} */ ([]); choiceIssues(issues, q); return issues; },
    gradingNote: () => 'Full marks for the correct answer, otherwise 0.',
    autoGraded: () => true,
    participantHint: 'Choose one answer',
    editor: choiceEditor,
    preview: choicePreview
  },
  checkboxes: {
    id: 'checkboxes',
    label: 'Checkboxes',
    icon: 'checkboxType',
    summary: 'Participants can pick several answers',
    hasOptions: true,
    fields: ['options'],
    defaults: () => ({ options: [blankOption(), blankOption()] }),
    validate: (q) => { const issues = /** @type {QuestionIssue[]} */ ([]); choiceIssues(issues, q); return issues; },
    gradingNote: (_q, settings) => settings.checkboxScoring === 'partial'
      ? 'Partial credit: each correct option a participant ticks earns part of the marks, and wrong ones take it away (never below 0).'
      : 'Participants get the marks only if they select every correct option and no wrong ones.',
    autoGraded: () => true,
    participantHint: 'Select all that apply',
    editor: choiceEditor,
    preview: choicePreview
  },
  short_answer: {
    id: 'short_answer',
    label: 'Short answer',
    icon: 'shortType',
    summary: 'A word or a short phrase',
    hasOptions: false,
    fields: ['acceptedAnswers', 'caseSensitive', 'maxLength'],
    defaults: () => ({ acceptedAnswers: [], caseSensitive: false, maxLength: null }),
    validate: (q) => {
      /** @type {QuestionIssue[]} */
      const issues = [];
      const answers = (q.acceptedAnswers || []).map((a) => (q.caseSensitive ? a : a.toLowerCase()).replace(/\s+/g, ' ').trim());
      if (new Set(answers).size !== answers.length) issues.push({ code: 'accepted-duplicate', message: 'Some accepted answers are the same.', level: 'warning', target: 'accepted' });
      if (answers.length > MAX_ACCEPTED_ANSWERS) issues.push({ code: 'accepted-max', message: `Use ${MAX_ACCEPTED_ANSWERS} accepted answers or fewer.`, level: 'error', target: 'accepted' });
      return issues;
    },
    gradingNote: (q) => ((q.acceptedAnswers || []).length
      ? (q.caseSensitive
        ? 'Full marks if the answer matches an accepted answer, including capital letters. Extra spaces are ignored.'
        : 'Full marks if the answer matches an accepted answer. Capital letters and extra spaces are ignored.')
      : 'Graded manually: a grader marks each answer by hand.'),
    autoGraded: (q) => (q.acceptedAnswers || []).length > 0,
    participantHint: 'Type a short answer',
    editor: shortAnswerEditor,
    preview: shortAnswerPreview
  },
  paragraph: {
    id: 'paragraph',
    label: 'Paragraph',
    icon: 'paragraphType',
    summary: 'A longer written answer',
    hasOptions: false,
    fields: ['gradingNotes', 'maxLength'],
    defaults: () => ({ gradingNotes: '', maxLength: null }),
    validate: () => [],
    gradingNote: () => 'Always graded manually. Scores stay provisional until a grader marks the answer.',
    autoGraded: () => false,
    participantHint: 'Write your answer',
    editor: paragraphEditor,
    preview: paragraphPreview
  }
};

/** Menu and selector order. */
export const TYPE_ORDER = /** @type {QuestionType[]} */ (['multiple_choice', 'checkboxes', 'short_answer', 'paragraph']);

/**
 * A new question with the type's defaults (1 mark, empty text).
 * @param {QuestionType} type
 * @returns {Question}
 */
export function createQuestion(type) {
  return /** @type {Question} */ ({
    id: newId(), type, order: 0, text: '', explanation: null, marks: 1, image: null, appearance: {}, source: null,
    ...QUESTION_TYPES[type].defaults()
  });
}

/**
 * Every issue with a question: the common fields plus the type's own rules.
 * @param {Question} q
 * @returns {QuestionIssue[]}
 */
export function validateQuestion(q) {
  /** @type {QuestionIssue[]} */
  const issues = [];
  if (!q.text.trim()) issues.push({ code: 'text', message: 'Add the question text.', level: 'error', target: 'text' });
  if (!(Number(q.marks) > 0)) issues.push({ code: 'marks', message: 'Give this question marks above 0.', level: 'error', target: 'marks' });
  if (q.image && !q.image.decorative && !q.image.alt.trim()) {
    issues.push({ code: 'alt', message: 'Describe the image for participants who can’t see it, or mark it as decorative.', level: 'error', target: 'image' });
  }
  const type = QUESTION_TYPES[q.type];
  return type ? [...issues, ...type.validate(q)] : issues;
}

/**
 * Change a question's type. Text, marks, image and explanation always stay.
 * Returns what would be lost, in words, so the editor can ask first.
 * @param {Question} q
 * @param {QuestionType} toType
 * @returns {{ question: Question, lost: string[] }}
 */
export function convertQuestion(q, toType) {
  if (q.type === toType) return { question: q, lost: [] };
  const from = QUESTION_TYPES[q.type];
  const to = QUESTION_TYPES[toType];
  /** @type {Question} */
  const next = /** @type {Question} */ ({
    id: q.id, type: toType, order: q.order, text: q.text, explanation: q.explanation, marks: q.marks,
    image: q.image, appearance: q.appearance, source: q.source,
    ...to.defaults()
  });
  /** @type {string[]} */
  const lost = [];
  const options = q.options || [];
  const optionWord = (/** @type {number} */ n) => `${n} option${n === 1 ? '' : 's'}`;

  if (from.hasOptions && to.hasOptions) {
    next.options = options.map((o) => ({ ...o }));
    if (toType === 'multiple_choice') {
      const correct = next.options.filter((o) => o.isCorrect);
      if (correct.length > 1) {
        const keep = correct[0].id;
        next.options = next.options.map((o) => ({ ...o, isCorrect: o.id === keep }));
        lost.push(`the correct mark on ${optionWord(correct.length - 1)} (multiple choice has one correct answer)`);
      }
    }
  } else if (from.hasOptions && toType === 'short_answer') {
    const correct = [...new Set(options.filter((o) => o.isCorrect && o.text.trim()).map((o) => o.text.trim()))];
    next.acceptedAnswers = correct.slice(0, MAX_ACCEPTED_ANSWERS);
    if (options.length) {
      lost.push(correct.length
        ? `${optionWord(options.length)} (the correct ${correct.length === 1 ? 'one becomes an accepted answer' : 'ones become accepted answers'})`
        : optionWord(options.length));
    }
  } else if (from.hasOptions) {
    if (options.length) lost.push(`${optionWord(options.length)} and the correct answers`);
  } else if (q.type === 'short_answer' && to.hasOptions) {
    const answers = q.acceptedAnswers || [];
    next.options = answers.slice(0, MAX_OPTIONS).map((text, index) => ({ ...blankOption(text), isCorrect: toType === 'checkboxes' || index === 0 }));
    while ((next.options || []).length < MIN_OPTIONS) next.options = [...(next.options || []), blankOption()];
    if (q.caseSensitive) lost.push('the case-sensitive setting');
  } else if (q.type === 'short_answer' && toType === 'paragraph') {
    next.maxLength = q.maxLength ?? null;
    if ((q.acceptedAnswers || []).length) lost.push(`${(q.acceptedAnswers || []).length} accepted answer${(q.acceptedAnswers || []).length === 1 ? '' : 's'}`);
  } else if (q.type === 'paragraph') {
    if (toType === 'short_answer') next.maxLength = q.maxLength ?? null;
    if ((q.gradingNotes || '').trim()) lost.push('the grading notes');
  }
  return { question: next, lost };
}

/**
 * Every question as plain text, for "Copy my changes" when a save can't go
 * through. Correct answers are included: this is only ever copied by the
 * admin, to their own clipboard.
 * @param {Question[]} questions
 */
export function questionsToText(questions) {
  return questions.map((q, index) => {
    const type = QUESTION_TYPES[q.type];
    const lines = [`${index + 1}. (${type ? type.label : q.type}, ${q.marks} mark${q.marks === 1 ? '' : 's'}) ${q.text.trim() || '[no question text]'}`];
    if (q.image) lines.push(`   Image: ${q.image.decorative ? 'decorative' : q.image.alt || '[no alt text]'}`);
    for (const option of q.options || []) lines.push(`   [${option.isCorrect ? 'x' : ' '}] ${option.text.trim() || '[empty option]'}`);
    if (q.type === 'short_answer') lines.push(`   Accepted answers: ${(q.acceptedAnswers || []).join(' | ') || 'none (graded manually)'}${q.caseSensitive ? ' (case sensitive)' : ''}`);
    if (q.type === 'paragraph' && q.gradingNotes) lines.push(`   Grading notes: ${q.gradingNotes}`);
    if (q.explanation) lines.push(`   Explanation: ${q.explanation}`);
    return lines.join('\n');
  }).join('\n\n');
}
