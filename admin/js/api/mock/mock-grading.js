// @ts-check
/**
 * DEMO MODE ONLY — how the demo server grades attempts, standing in for the
 * backend's grading engine. The admin site itself never grades: Results only
 * shows the marks and totals the server returns.
 * Rules (section 15 and the agreed defaults):
 * - Multiple choice: full marks for the correct option, otherwise 0.
 * - Checkboxes: all-or-nothing, or partial credit (each correct tick earns a
 *   share, each wrong tick takes a share away, never below 0).
 * - Short answer with accepted answers: full marks for a match (extra spaces
 *   ignored; capitals ignored unless case-sensitive). Without accepted
 *   answers it waits for a grader.
 * - Paragraph: always waits for a grader.
 */

/** @param {number} n */
const round2 = (n) => Math.round(n * 100) / 100;
/** @param {string} text */
const squash = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/** Does this question need a person to grade it? @param {any} question */
export function needsGrader(question) {
  if (question.type === 'paragraph') return true;
  return question.type === 'short_answer' && !(question.acceptedAnswers || []).length;
}

/**
 * Automatic marks for one answer, or null when a grader decides.
 * @param {any} question
 * @param {{ selectedOptionIds: string[], text: string | null }} answer
 * @param {{ checkboxScoring: string }} settings
 */
export function autoMarks(question, answer, settings) {
  const marks = Number(question.marks) || 0;
  if (needsGrader(question)) return null;
  if (question.type === 'multiple_choice') {
    const correct = (question.options || []).find((/** @type {any} */ o) => o.isCorrect);
    return correct && answer.selectedOptionIds.length === 1 && answer.selectedOptionIds[0] === correct.id ? marks : 0;
  }
  if (question.type === 'checkboxes') {
    const correctIds = new Set((question.options || []).filter((/** @type {any} */ o) => o.isCorrect).map((/** @type {any} */ o) => o.id));
    const picked = new Set(answer.selectedOptionIds);
    const right = [...picked].filter((id) => correctIds.has(id)).length;
    const wrong = picked.size - right;
    if (settings.checkboxScoring === 'partial') {
      return correctIds.size ? round2(Math.max(0, (right - wrong) / correctIds.size) * marks) : 0;
    }
    return right === correctIds.size && wrong === 0 && correctIds.size > 0 ? marks : 0;
  }
  if (question.type === 'short_answer') {
    const given = squash(answer.text || '');
    if (!given) return 0;
    const same = (/** @type {string} */ a) => (question.caseSensitive ? squash(a) === given : squash(a).toLowerCase() === given.toLowerCase());
    return (question.acceptedAnswers || []).some(same) ? marks : 0;
  }
  return 0;
}

/**
 * Work out an attempt's score and status from its answers (the backend's job).
 * In-progress attempts keep their status and have no score yet.
 * @param {any} attempt
 * @param {any} quiz
 */
export function recompute(attempt, quiz) {
  const byId = new Map(quiz.questions.map((/** @type {any} */ q) => [q.id, q]));
  attempt.maxScore = round2(quiz.questions.reduce((/** @type {number} */ sum, /** @type {any} */ q) => sum + (Number(q.marks) || 0), 0));
  if (attempt.status === 'in_progress') {
    attempt.score = null;
    return attempt;
  }
  let total = 0;
  let waiting = 0;
  for (const answer of attempt.answers) {
    const question = byId.get(answer.questionId);
    if (!question) continue;
    answer.needsManualGrading = needsGrader(question);
    if (answer.needsManualGrading) {
      answer.autoMarks = null;
      if (answer.manualMarks === null || answer.manualMarks === undefined) waiting += 1;
      else total += Number(answer.manualMarks);
    } else {
      answer.autoMarks = autoMarks(question, answer, quiz.settings);
      total += Number(answer.autoMarks) || 0;
    }
  }
  attempt.score = round2(total);
  attempt.status = waiting ? 'pending_grading' : 'graded';
  return attempt;
}

/**
 * Mark which attempt counts for each participant (highest or latest, per the
 * quiz's setting). In-progress attempts never count.
 * @param {any[]} attempts   all attempts of one quiz
 * @param {any} quiz
 */
export function markFinals(attempts, quiz) {
  /** @type {Map<string, any[]>} */
  const byPerson = new Map();
  for (const attempt of attempts) {
    attempt.isFinal = false;
    if (attempt.status === 'in_progress') continue;
    const list = byPerson.get(attempt.participant.id) || [];
    list.push(attempt);
    byPerson.set(attempt.participant.id, list);
  }
  for (const list of byPerson.values()) {
    const pick = quiz.settings.attemptScoring === 'latest'
      ? list.reduce((a, b) => (Date.parse(b.submittedAt) > Date.parse(a.submittedAt) ? b : a))
      : list.reduce((a, b) => ((b.score ?? -1) > (a.score ?? -1) ? b : a));
    pick.isFinal = true;
  }
  return attempts;
}
