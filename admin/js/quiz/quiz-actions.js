// @ts-check
/**
 * Quiz actions shared by the quiz list and the quiz editor. Each one explains
 * its consequences in plain language first, calls the API, and reports the
 * outcome with a toast. The page decides what happens next (refresh a list,
 * update the editor). The backend enforces the same rules.
 */
import { api } from '../api/index.js';
import { ApiError, userMessage } from '../api/client.js';
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { formatDateTime, formatNumber, plural } from '../core/format.js';
import { redirectToLogin } from '../core/session.js';
import { setFlash } from '../core/flash.js';
import { openDialog, confirmDialog, formDialog } from '../components/dialog.js';
import { rules, validateValue } from '../core/validate.js';
import { setFieldError, clearFieldError, showFormAlert, hideFormMessage } from '../components/form-feedback.js';
import { toast } from '../components/toast.js';
import { deleteBlockReason, quickPublishBlockers, isLocked, TITLE_MAX_LENGTH } from './quiz-rules.js';

/** @typedef {import('../types.js').QuizSummary} QuizSummary */
/** @typedef {import('../types.js').Quiz} Quiz */

/**
 * @typedef {Object} ActionHooks
 * @property {(busy: boolean) => void} [onBusy]                 show progress while the request runs
 * @property {(error: ApiError) => void} [onUnauthorized]      default: go to the login page
 * @property {() => void} [onNotFound]                          the quiz was deleted elsewhere
 * @property {(problems: string[]) => void | Promise<void>} [onNotReady]  default: a dialog with "Open quiz"
 * @property {string[]} [blockers]                              publish blockers already worked out (the editor runs the full checks)
 * @property {{ label: string, onClick: () => void }} [archivedToastAction]
 */

/** @param {Pick<QuizSummary, 'title'>} quiz */
export const quizName = (quiz) => `“${quiz.title.trim() || 'Untitled quiz'}”`;

/** @param {string} id */
export const editorUrl = (id) => `quiz-edit.html?id=${encodeURIComponent(id)}`;

/**
 * Run a request with busy feedback and the shared 401 / 404 handling.
 * Other errors are re-thrown for the action's own message.
 * @template T
 * @param {() => Promise<T>} request
 * @param {ActionHooks} hooks
 * @returns {Promise<T | null>}
 */
async function run(request, hooks) {
  hooks.onBusy?.(true);
  try {
    return await request();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      (hooks.onUnauthorized || redirectToLogin)(error);
      return null;
    }
    if (error instanceof ApiError && error.status === 404) {
      toast({ type: 'error', message: 'That quiz no longer exists. It may have been deleted somewhere else.' });
      hooks.onNotFound?.();
      return null;
    }
    throw error;
  } finally {
    hooks.onBusy?.(false);
  }
}

/** @param {unknown} error @param {string} what */
function failed(error, what) {
  toast({ type: 'error', message: `Couldn't ${what}. ${userMessage(error)}` });
}

/**
 * Key facts repeated in the publish confirmation (section 21).
 * @param {QuizSummary} quiz
 */
export function publishFacts(quiz) {
  const { settings } = quiz;
  /** @type {[string, string][]} */
  const rows = [
    ['Questions', formatNumber(quiz.questionCount)],
    ['Total marks', formatNumber(quiz.totalMarks)],
    ['Opens', settings.opensAt ? formatDateTime(settings.opensAt) : 'As soon as it’s published'],
    ['Closes', settings.closesAt ? formatDateTime(settings.closesAt) : 'No close date'],
    ['Attempts allowed', settings.maxAttempts === null ? 'Unlimited' : formatNumber(settings.maxAttempts)],
    ['Time limit', settings.durationMinutes ? plural(settings.durationMinutes, 'minute') : 'None']
  ];
  return el('dl', { class: 'facts' }, rows.map(([term, value]) =>
    el('div', { class: 'facts__row' }, el('dt', { text: term }), el('dd', { class: 'num', text: value }))));
}

/**
 * What the admin should know about a fresh copy (section 23): what was left
 * out on purpose, and anything the server couldn't copy.
 * @param {Pick<QuizSummary, 'settings'>} original
 * @param {{ item: string, reason: string }[]} notCopied
 * @returns {string[]}
 */
export function copyNotes(original, notCopied) {
  /** @type {string[]} */
  const notes = notCopied.map(({ item, reason }) => `Not copied: ${item}. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}`);
  if (original.settings.opensAt || original.settings.closesAt) notes.push('The open and close times were cleared, so you can schedule the copy fresh (Settings).');
  if (original.settings.resultVisibility === 'after_close') notes.push('Results are set to show after the quiz closes, so add a close time or choose another option before publishing.');
  notes.push('Participant attempts, results and the published status are never copied.');
  return notes;
}

/**
 * The default "not ready" dialog: lists the problems and offers to open the quiz.
 * @param {QuizSummary} quiz
 * @param {string[]} problems
 */
async function notReadyDialog(quiz, problems) {
  const choice = await openDialog({
    title: 'This quiz isn’t ready to publish',
    body: [
      `Fix ${problems.length === 1 ? 'this' : 'these'} in ${quizName(quiz)} first:`,
      el('ul', { class: 'problem-list' }, problems.map((problem) => el('li', {}, icon('alertCircle', { size: 16 }), el('span', { text: problem }))))
    ],
    actions: [
      { label: 'Close', value: 'close', variant: 'ghost' },
      { label: 'Open quiz', value: 'open', variant: 'primary', autofocus: true }
    ]
  });
  if (choice === 'open') window.location.href = editorUrl(quiz.id);
}

/**
 * Publish: quick checks, a confirmation that repeats the key facts, then the
 * server's own checks. Resolves with the published quiz, or null.
 * @param {QuizSummary} quiz
 * @param {ActionHooks} [hooks]
 * @returns {Promise<Quiz | null>}
 */
export async function publishQuiz(quiz, hooks = {}) {
  const notReady = (/** @type {string[]} */ problems) => (hooks.onNotReady ? hooks.onNotReady(problems) : notReadyDialog(quiz, problems));
  const blockers = hooks.blockers || quickPublishBlockers(quiz);
  if (blockers.length) {
    await notReady(blockers);
    return null;
  }
  const opensLater = quiz.settings.opensAt && Date.parse(quiz.settings.opensAt) > Date.now();
  const confirmed = await confirmDialog({
    title: `Publish ${quizName(quiz)}?`,
    message: [
      opensLater
        ? 'Participants will see it when it opens. Check the details below.'
        : 'Participants will be able to start it straight away. Check the details below.',
      publishFacts(quiz)
    ],
    confirmLabel: 'Publish quiz'
  });
  if (!confirmed) return null;
  try {
    const published = await run(() => api.publishQuiz(quiz.id), hooks);
    if (!published) return null;
    toast({
      type: 'success',
      message: published.availability === 'scheduled' && published.settings.opensAt
        ? `Published. ${quizName(published)} opens ${formatDateTime(published.settings.opensAt)}.`
        : `Published. Participants can now start ${quizName(published)}.`
    });
    return published;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'PUBLISH_BLOCKED') {
      const problems = Object.values(error.fieldErrors);
      await notReady(problems.length ? problems : [error.message]);
      return null;
    }
    failed(error, 'publish the quiz');
    return null;
  }
}

/**
 * @param {QuizSummary} quiz
 * @param {ActionHooks} [hooks]
 * @returns {Promise<Quiz | null>}
 */
export async function unpublishQuiz(quiz, hooks = {}) {
  const confirmed = await confirmDialog({
    title: `Unpublish ${quizName(quiz)}?`,
    message: [
      'Participants won’t be able to start new attempts. Anyone already taking it can finish and submit.',
      isLocked(quiz)
        ? 'It goes back to Drafts. Its questions stay locked because participants have already taken it.'
        : 'It goes back to Drafts, where you can edit it and publish it again.'
    ],
    confirmLabel: 'Unpublish'
  });
  if (!confirmed) return null;
  try {
    const updated = await run(() => api.unpublishQuiz(quiz.id), hooks);
    if (updated) toast({ type: 'success', message: `Unpublished. ${quizName(quiz)} is back in Drafts.` });
    return updated;
  } catch (error) {
    failed(error, 'unpublish the quiz');
    return null;
  }
}

/**
 * @param {QuizSummary} quiz
 * @param {ActionHooks} [hooks]
 * @param {{ confirm?: boolean }} [options]   confirm: false when the admin already chose "Archive instead"
 * @returns {Promise<Quiz | null>}
 */
export async function archiveQuiz(quiz, hooks = {}, { confirm = true } = {}) {
  if (confirm) {
    const confirmed = await confirmDialog({
      title: `Archive ${quizName(quiz)}?`,
      message: [
        quiz.status === 'published'
          ? 'Participants will no longer be able to start it. It will be hidden from your active lists and become read-only.'
          : 'It will be hidden from your active lists and become read-only.',
        quiz.attemptCount
          ? `Its ${plural(quiz.attemptCount, 'attempt')} and results are kept. You can restore it at any time.`
          : 'You can restore it at any time.'
      ],
      confirmLabel: 'Archive'
    });
    if (!confirmed) return null;
  }
  try {
    const updated = await run(() => api.archiveQuiz(quiz.id), hooks);
    if (updated) toast({ type: 'success', message: `Archived ${quizName(quiz)}.`, action: hooks.archivedToastAction });
    return updated;
  } catch (error) {
    failed(error, 'archive the quiz');
    return null;
  }
}

/**
 * Restoring isn't destructive, so it happens straight away.
 * @param {QuizSummary} quiz
 * @param {ActionHooks} [hooks]
 * @returns {Promise<Quiz | null>}
 */
export async function restoreQuiz(quiz, hooks = {}) {
  try {
    const updated = await run(() => api.restoreQuiz(quiz.id), hooks);
    if (updated) toast({ type: 'success', message: `Restored. ${quizName(quiz)} is back in Drafts.` });
    return updated;
  } catch (error) {
    failed(error, 'restore the quiz');
    return null;
  }
}

/**
 * Delete a draft with no attempts. For anything else the dialog explains why
 * and offers Archive instead.
 * @param {QuizSummary} quiz
 * @param {ActionHooks} [hooks]
 * @returns {Promise<{ deleted: true } | { archived: Quiz } | null>}
 */
export async function deleteQuiz(quiz, hooks = {}) {
  const reason = deleteBlockReason(quiz);
  if (reason) {
    const choice = await openDialog({
      title: 'This quiz can’t be deleted',
      body: [reason, 'Archive it instead: it will be hidden and read-only, and its results are kept.'],
      actions: [
        { label: 'Cancel', value: 'cancel', variant: 'ghost', autofocus: true },
        { label: 'Archive instead', value: 'archive', variant: 'primary' }
      ]
    });
    if (choice !== 'archive') return null;
    const archived = await archiveQuiz(quiz, hooks, { confirm: false });
    return archived ? { archived } : null;
  }
  const confirmed = await confirmDialog({
    title: `Delete ${quizName(quiz)}?`,
    message: [
      quiz.questionCount
        ? `This permanently deletes the draft and its ${plural(quiz.questionCount, 'question')}.`
        : 'This permanently deletes the draft.',
      'This can’t be undone.'
    ],
    confirmLabel: 'Delete quiz',
    tone: 'danger'
  });
  if (!confirmed) return null;
  try {
    let done = false;
    await run(async () => { await api.deleteQuiz(quiz.id); done = true; }, hooks);
    if (!done) return null;
    toast({ type: 'success', message: `Deleted ${quizName(quiz)}.` });
    return { deleted: true };
  } catch (error) {
    failed(error, 'delete the quiz');
    return null;
  }
}

/**
 * Duplicate into a NEW, unpublished draft (section 23), then open the copy.
 * Nothing about participants is copied: no attempts, scores or publication status.
 * @param {QuizSummary} quiz
 * @param {ActionHooks} [hooks]
 * @returns {Promise<Quiz | null>}
 */
export async function duplicateQuiz(quiz, hooks = {}) {
  try {
    const result = await run(() => api.duplicateQuiz(quiz.id), hooks);
    if (!result) return null;
    const copy = result.quiz;
    setFlash({ type: 'success', message: `Duplicated. You’re editing the copy, “${copy.title}”.`, notes: copyNotes(quiz, result.notCopied) });
    window.location.href = `${editorUrl(copy.id)}#details`;
    return copy;
  } catch (error) {
    failed(error, 'duplicate the quiz');
    return null;
  }
}

/**
 * New quiz: ask for a title, create the draft, then open it in the editor.
 * Used by the quiz list and the Dashboard.
 */
export async function newQuizDialog() {
  const inputId = 'new-quiz-title';
  const input = el('input', {
    class: 'input',
    id: inputId,
    name: 'title',
    type: 'text',
    autocomplete: 'off',
    attrs: { 'aria-describedby': `${inputId}-hint`, required: true }
  });
  const counter = el('span', { class: 'char-count num', attrs: { 'aria-hidden': 'true' }, text: `0 / ${TITLE_MAX_LENGTH}` });
  const alertSlot = el('div', { hidden: true });
  const field = el('div', { class: 'field' },
    el('label', { class: 'field__label', for: inputId, text: 'Quiz title' }),
    el('div', { class: 'field__control' }, input),
    el('div', { class: 'field__row' },
      el('p', { class: 'field__hint', id: `${inputId}-hint`, text: `For example “Leadership Essentials”. Up to ${TITLE_MAX_LENGTH} characters.` }),
      counter),
    el('div', { class: 'field__message' }, el('div', {})));

  const validate = () => validateValue(input.value, [
    rules.required('Enter a title for the quiz'),
    rules.maxLength(TITLE_MAX_LENGTH, 'Title')
  ]);
  input.addEventListener('input', () => {
    const length = input.value.length;
    counter.textContent = `${length} / ${TITLE_MAX_LENGTH}`;
    counter.classList.toggle('is-over', length > TITLE_MAX_LENGTH);
    counter.classList.toggle('is-near', length > TITLE_MAX_LENGTH - 20 && length <= TITLE_MAX_LENGTH);
    if (input.getAttribute('aria-invalid') === 'true') {
      const message = validate();
      if (message) setFieldError(input, message, { shake: false });
      else clearFieldError(input);
    }
  });

  const created = await formDialog({
    title: 'New quiz',
    description: 'Start with a title. Next you’ll add the details, questions and settings — it stays a private draft until you publish it.',
    body: [alertSlot, field],
    submitLabel: 'Create quiz',
    onSubmit: async () => {
      hideFormMessage(alertSlot);
      const message = validate();
      if (message) {
        setFieldError(input, message);
        input.focus();
        return undefined;
      }
      try {
        return await api.createQuiz({ title: input.value });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return undefined;
        }
        if (error instanceof ApiError && error.fieldErrors.title) {
          setFieldError(input, error.fieldErrors.title);
          input.focus();
          return undefined;
        }
        showFormAlert(alertSlot, userMessage(error));
        return undefined;
      }
    }
  });

  if (created) {
    setFlash({ type: 'success', message: `Draft created. “${created.title}” is private until you publish it.` });
    window.location.href = `${editorUrl(created.id)}#details`;
  }
}
