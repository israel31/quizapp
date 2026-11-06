
// ========================================
// JCIN UNIBEN QUIZ - RESULT CONTROLLER
// ========================================

const SUPABASE_URL = "https://eroogvrsmlfpcdmnvxsf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EwKWVrQlbM7EzmKVdKHS_Q_nHSKigzb";
const STUDENT_API = `${SUPABASE_URL}/functions/v1/quiz-student`;

const themeBtn = document.querySelector(".theme");
const themeIcon = document.querySelector(".theme-icon");
const candidateName = document.querySelector(".candidate-name");
const candidateEmail = document.querySelector(".candidate-email");
const quizTitleBadge = document.querySelector(".result-quiz-title");
const performanceBadge = document.querySelector(".performance-badge");
const studentScore = document.querySelector(".score-amount");
const percentageScore = document.querySelector(".percentage-score");
const failedScore = document.querySelector(".failed-amount");
const numAttempted = document.querySelector(".num-attempted");
const numNotAttempted = document.querySelector(".mun-not-attempted");
const reviewSection = document.querySelector("#reviewSection");
const reviewCardsContainer = document.querySelector("#reviewCardsContainer");
const reviewCountEl = document.querySelector("#reviewCount");

const studentInfo = JSON.parse(localStorage.getItem("studentInfo") || "null");
const attemptId = localStorage.getItem("lastSubmittedAttemptId");
const resumeToken = localStorage.getItem("lastSubmittedResumeToken");

function updateThemeIcon() {
    if (!themeIcon) return;
    const isLight = document.body.classList.contains("light-theme");
    themeIcon.textContent = isLight ? "dark_mode" : "light_mode";
}

const savedTheme = localStorage.getItem("theme");
const systemPrefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;

document.body.classList.toggle(
    "light-theme",
    savedTheme === "light" || (!savedTheme && systemPrefersLight)
);

updateThemeIcon();

themeBtn?.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light-theme");
    localStorage.setItem("theme", isLight ? "light" : "dark");
    updateThemeIcon();
});

if (candidateName) {
    candidateName.textContent = studentInfo?.name || "Candidate";
}

if (candidateEmail) {
    candidateEmail.textContent = studentInfo?.email || "No email";
}

async function getResult() {
    if (!attemptId || !resumeToken) {
        showUnavailable("We could not find your submitted assessment.");
        return;
    }

    try {
        const response = await fetch(STUDENT_API, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
                action: "get_result",
                attemptId,
                resumeToken
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Unable to retrieve your result.");
        }

        if (!data.available) {
            showUnavailable(data.message || "Your result is not available yet.");
            return;
        }

        renderResult(data);
    } catch (error) {
        console.error("Result retrieval failed:", error);
        showUnavailable(error.message || "Unable to load your result.");
    }
}

function showUnavailable(message) {
    if (percentageScore) percentageScore.textContent = "--";
    if (performanceBadge) performanceBadge.textContent = message;
    if (reviewSection) reviewSection.style.display = "none";
}

function renderResult(result) {
    const score = Number(result.score || 0);
    const maxScore = Number(result.maxScore || 0);
    const percentage = Number(result.percentage || 0);
    const answers = result.answers || [];

    const attempted = Number(result.attemptedCount || 0);
    const totalQuestions = Number(result.questionCount || 0);
    const notAttempted = Math.max(0, totalQuestions - attempted);
    const failed = Math.max(0, maxScore - score);

    if (quizTitleBadge) {
        quizTitleBadge.textContent = result.quizTitle || "Assessment Result";
    }

    if (studentScore) studentScore.textContent = `${score} / ${maxScore}`;
    if (percentageScore) percentageScore.textContent = `${percentage}%`;
    if (failedScore) failedScore.textContent = String(failed);
    if (numAttempted) numAttempted.textContent = String(attempted);
    if (numNotAttempted) numNotAttempted.textContent = String(notAttempted);

    if (performanceBadge) {
        if (result.status === "pending_grading") {
            performanceBadge.textContent =
                "Your submission has been received and is awaiting manual grading.";
        } else if (percentage >= 80) {
            performanceBadge.textContent =
                "🏆 Outstanding Achievement! Passed with Distinction.";
        } else if (percentage >= 60) {
            performanceBadge.textContent =
                "👏 Well Done! Passed Assessment.";
        } else if (percentage >= 50) {
            performanceBadge.textContent =
                "👍 Satisfactory Attempt. Minimum threshold met.";
        } else {
            performanceBadge.textContent =
                "📚 Needs Improvement. Recommended to review the materials.";
        }
    }

    if (!result.showCorrectAnswers || !answers.length) {
        if (reviewSection) reviewSection.style.display = "none";
        return;
    }

    renderReview(answers, score, maxScore);
}

function renderReview(answers, score, maxScore) {
    if (!reviewCardsContainer) return;

    reviewCardsContainer.innerHTML = "";

    if (reviewCountEl) {
        reviewCountEl.textContent = `${score} of ${maxScore} marks`;
    }

    answers.forEach(item => {
        const card = document.createElement("div");
        card.className = "review-card";

        const header = document.createElement("div");
        header.className = "review-card__header";

        const title = document.createElement("div");
        title.className = "review-card__title";
        title.textContent = `${item.number}. ${item.questionText}`;

        const status = document.createElement("span");
        status.className = "review-card__status";

        if (item.needsManualGrading) {
            status.textContent = "Awaiting grading";
        } else {
            status.textContent =
                Number(item.awardedMarks) > 0 ? "✓ Marks awarded" : "✕ No marks";
        }

        header.appendChild(title);
        header.appendChild(status);
        card.appendChild(header);

        const chosen = document.createElement("div");
        chosen.className = "review-card__detail";

        const selectedText = item.selectedText?.length
            ? item.selectedText.join(", ")
            : item.responseText || "No answer provided";

        chosen.textContent = `Your answer: ${selectedText}`;
        card.appendChild(chosen);

        if (item.correctText?.length) {
            const correct = document.createElement("div");
            correct.className = "review-card__detail";
            correct.textContent = `Correct answer: ${item.correctText.join(", ")}`;
            card.appendChild(correct);
        }

        if (item.feedback) {
            const feedback = document.createElement("div");
            feedback.className = "review-card__detail";
            feedback.textContent = `Feedback: ${item.feedback}`;
            card.appendChild(feedback);
        }

        reviewCardsContainer.appendChild(card);
    });
}

getResult();
