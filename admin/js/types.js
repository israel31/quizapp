// @ts-check
/**
 * Shared data shapes for the admin site (JSDoc only — no runtime code).
 * They follow the PROPOSED contract in README section "API contract".
 * If the backend's final field names differ, only js/api/adapters.js changes;
 * these shapes describe the admin site's own model.
 *
 * Other files refer to these with an import type, for example
 * import('../types.js').Quiz inside a JSDoc type.
 */

/** @typedef {'draft' | 'published' | 'archived'} QuizStatus */
/** @typedef {'scheduled' | 'open' | 'closed'} Availability */
/** @typedef {'multiple_choice' | 'checkboxes' | 'short_answer' | 'paragraph'} QuestionType */
/** @typedef {'in_progress' | 'submitted' | 'pending_grading' | 'graded'} AttemptStatus */

/**
 * @typedef {Object} Admin
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string} role   Default single role: 'admin' (PENDING #8)
 */

/**
 * @typedef {Object} Appearance
 * @property {string} fontFamily      One of: Inter, Poppins, Nunito, Lora, Merriweather, Roboto Slab
 * @property {number} fontSize        14 | 16 | 18 | 20 | 24 | 28
 * @property {string} textColor       Hex, e.g. "#130F2D"
 * @property {string} pageBackground
 * @property {string} cardBackground
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {boolean} underline
 * @property {'left' | 'center'} align
 */

/**
 * Per-question overrides: only the properties this question changes (never
 * pageBackground). An empty object means "inherit everything".
 * Image placement and size live on the image itself (QuizImage).
 * The rules are in js/quiz/appearance.js.
 * @typedef {Partial<Omit<Appearance, 'pageBackground'>>} AppearanceOverrides
 */

/** @typedef {'above' | 'below' | 'beside'} ImagePlacement */
/** @typedef {'small' | 'medium' | 'full'} ImageSize */

/**
 * @typedef {Object} QuizImage
 * @property {string} assetId       From the backend's upload endpoint — never a local file path
 * @property {string} url
 * @property {string} alt
 * @property {boolean} decorative
 * @property {ImagePlacement} [placement]
 * @property {ImageSize} [size]
 */

/**
 * @typedef {Object} Option
 * @property {string} id
 * @property {string} text
 * @property {QuizImage | null} image
 * @property {boolean} isCorrect     ADMIN-ONLY: must never reach participants
 */

/**
 * @typedef {Object} Question
 * @property {string} id
 * @property {QuestionType} type
 * @property {number} order
 * @property {string} text
 * @property {string | null} explanation
 * @property {number} marks
 * @property {QuizImage | null} image
 * @property {Option[]} [options]              Choice types only
 * @property {string[]} [acceptedAnswers]      Short answer only — ADMIN-ONLY
 * @property {boolean} [caseSensitive]         Short answer only — ADMIN-ONLY
 * @property {number | null} [maxLength]       Text types
 * @property {string} [gradingNotes]           Paragraph only — ADMIN-ONLY
 * @property {AppearanceOverrides} appearance
 * @property {{ bankQuestionId: string, bankVersion: number } | null} source
 */

/**
 * @typedef {Object} QuizSettings
 * @property {number | null} durationMinutes     null = untimed
 * @property {string | null} opensAt             ISO 8601 UTC, null = opens when published
 * @property {string | null} closesAt            ISO 8601 UTC, null = stays open
 * @property {number | null} maxAttempts         null = unlimited
 * @property {'highest' | 'latest'} attemptScoring
 * @property {'all_or_nothing' | 'partial'} checkboxScoring
 * @property {'immediately' | 'after_close' | 'manual'} resultVisibility
 * @property {boolean} showCorrectAnswers
 * @property {boolean} shortAnswerCaseSensitive  default for NEW short-answer questions (PENDING: proposed field)
 */

/**
 * A quiz as shown in lists: everything except questions and appearance.
 * @typedef {Object} QuizSummary
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {QuizStatus} status
 * @property {Availability | null} availability   From the backend (server time); null unless published
 * @property {QuizSettings} settings
 * @property {number} questionCount
 * @property {number} totalMarks                  From the backend
 * @property {number} attemptCount
 * @property {number} pendingGradingCount         attempts waiting for grading (Results)
 * @property {number} version                     For conflict detection (409)
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string | null} publishedAt
 */

/**
 * A full quiz (GET /admin/quizzes/{id}).
 * @typedef {QuizSummary & {
 *   instructions: string,
 *   appearance: Appearance,
 *   questions: Question[]
 * }} Quiz
 */

/**
 * @typedef {Omit<Question, 'order' | 'source'> & {
 *   tags: string[],
 *   status: 'active' | 'archived',
 *   version: number,
 *   usedInQuizCount: number,
 *   createdAt: string,
 *   updatedAt: string
 * }} BankQuestion
 */

/**
 * Whoever took a quiz: anyone with an account (not only students).
 * Results show name and email only (agreed decision 11).
 * @typedef {Object} Participant
 * @property {string} id
 * @property {string} name
 * @property {string} email
 */

/**
 * One answer in an attempt. Marks always come from the backend.
 * @typedef {Object} Answer
 * @property {string} questionId
 * @property {string[]} selectedOptionIds
 * @property {string | null} text            The participant's text: always shown as plain text, never HTML
 * @property {number | null} autoMarks       Set by automatic grading
 * @property {number | null} manualMarks     Set by a grader (paragraphs, short answers with no accepted answers)
 * @property {string | null} feedback
 * @property {boolean} needsManualGrading
 */

/**
 * An attempt as listed in Results.
 * @typedef {Object} AttemptSummary
 * @property {string} id
 * @property {string} quizId
 * @property {Participant} participant
 * @property {number} attemptNumber
 * @property {AttemptStatus} status
 * @property {string} startedAt
 * @property {string | null} submittedAt
 * @property {number | null} score          From the backend — never calculated in the browser
 * @property {number} maxScore
 * @property {boolean} isFinal              The attempt that counts (highest or latest, per the quiz)
 */

/**
 * One attempt in full (GET /admin/attempts/{id}): the answers, the questions
 * exactly as the participant saw them (admin view, with correct answers),
 * and where to go next.
 * @typedef {AttemptSummary & {
 *   quiz: { id: string, title: string, status: QuizStatus },
 *   answers: Answer[],
 *   questions: Question[],
 *   navigation: { previousId: string | null, nextId: string | null, nextToGradeId: string | null }
 * }} Attempt
 */

/**
 * The numbers above a quiz's attempts (GET /admin/quizzes/{id}/results/summary).
 * Percentages are of the total marks; null when there's nothing to show.
 * @typedef {Object} ResultsSummary
 * @property {number} attempts               submitted attempts
 * @property {number | null} averagePercent
 * @property {number | null} highestPercent
 * @property {number | null} lowestPercent
 * @property {number} pendingGrading         attempts waiting for a grader
 */

/**
 * One recent submission on the Dashboard.
 * @typedef {Object} RecentSubmission
 * @property {string} attemptId
 * @property {string} quizId
 * @property {string} quizTitle
 * @property {Participant} participant
 * @property {string} submittedAt
 * @property {AttemptStatus} status
 * @property {number | null} score          From the backend
 * @property {number} maxScore
 */

/**
 * A quiz that needs attention: waiting for grading (count), closing or opening soon (at).
 * @typedef {Object} AttentionQuiz
 * @property {string} id
 * @property {string} title
 * @property {number} count
 * @property {string | null} at
 */

/**
 * Everything on the Dashboard (GET /admin/dashboard/summary). A list is null
 * when the backend doesn't send it, and the Dashboard says so honestly.
 * @typedef {Object} DashboardSummary
 * @property {{ quizzes: number, published: number, drafts: number, archived: number, attempts: number }} totals
 *   quizzes = drafts + published (archived counted separately); attempts = all participant attempts
 * @property {{ attempts: number, quizzes: AttentionQuiz[] } | null} pendingGrading
 * @property {AttentionQuiz[] | null} closingSoon     open quizzes closing within 72 hours
 * @property {AttentionQuiz[] | null} openingSoon     scheduled quizzes opening within 7 days
 * @property {QuizSummary[]} recentQuizzes            about 5, most recently updated first
 * @property {RecentSubmission[] | null} recentSubmissions
 */

/**
 * @typedef {Object} ApiErrorShape
 * @property {number} status          HTTP status, or 0 for network failures/timeouts
 * @property {string} code            e.g. "VALIDATION_ERROR", "NETWORK_ERROR"
 * @property {string} message
 * @property {Record<string, string>} fieldErrors
 * @property {'http' | 'network' | 'timeout'} kind
 */

/**
 * A page of results from a list endpoint.
 * @template T
 * @typedef {Object} Page
 * @property {T[]} items
 * @property {number} page
 * @property {number} pageSize
 * @property {number} total
 */

export {};
