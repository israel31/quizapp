// @ts-check
/**
 * Student Result Controller (result.js)
 * Displays candidate scores, performance badges, and detailed question breakdown.
 */

const themeBtn = document.querySelector('.theme'),
     themeIcon = document.querySelector('.theme-icon'),
     candidateName = document.querySelector('.candidate-name'),
     candidateEmail = document.querySelector('.candidate-email'),
     quizTitleBadge = document.querySelector('.result-quiz-title'),
     performanceBadge = document.querySelector('.performance-badge'),
     studentScore = document.querySelector('.score-amount'),
     percentageScore = document.querySelector('.percentage-score'),
     failedScore = document.querySelector('.failed-amount'),
     numAttempted = document.querySelector('.num-attempted'),
     numNotAttempted = document.querySelector('.mun-not-attempted'),
     reviewSection = document.querySelector('#reviewSection'),
     reviewCardsContainer = document.querySelector('#reviewCardsContainer'),
     reviewCountEl = document.querySelector('#reviewCount');

// Updates the theme icon based on current theme
const updateThemeIcon = () => {
    const isLight = document.body.classList.contains("light-theme");
    if (themeIcon) themeIcon.textContent = isLight ? "dark_mode" : "light_mode";
};

// Apply light theme if saved or system prefers
const savedTheme = localStorage.getItem("theme");
const systemPrefersLight = window.matchMedia("(prefers-color-scheme:light)").matches;
const shouldUseLightTheme = savedTheme === "light" || (!savedTheme && systemPrefersLight);
document.body.classList.toggle("light-theme", shouldUseLightTheme);

if (themeBtn) {
    themeBtn.addEventListener("click", () => {
        const isLight = document.body.classList.toggle("light-theme");
        localStorage.setItem("theme", isLight ? "light" : "dark");
        updateThemeIcon(); 
    });
}

// Retrieve student information
const studentInfo = JSON.parse(localStorage.getItem("studentInfo") || "null");
if (studentInfo) {
    if (candidateName) candidateName.textContent = studentInfo.name || "Candidate";
    if (candidateEmail) candidateEmail.textContent = studentInfo.email || "No email";
}

// Retrieve Result information
const resultDetails = JSON.parse(localStorage.getItem("resultDetails") || "null");

if (resultDetails) {
    const totalQuestions = resultDetails.questionCount || 40;
    const score = Number(resultDetails.score) || 0;
    const notAttempted = Number(resultDetails.notAttempted) || 0;
    const attempted = totalQuestions - notAttempted;
    const failed = Math.max(0, totalQuestions - score);
    const percentage = Math.round((score / totalQuestions) * 100);

    if (quizTitleBadge && resultDetails.quizTitle) {
        quizTitleBadge.textContent = resultDetails.quizTitle;
    }

    if (studentScore) studentScore.textContent = String(score);
    if (percentageScore) percentageScore.textContent = `${percentage}%`;
    if (failedScore) failedScore.textContent = String(failed);
    if (numAttempted) numAttempted.textContent = String(attempted);
    if (numNotAttempted) numNotAttempted.textContent = String(notAttempted);

    if (performanceBadge) {
        if (percentage >= 80) {
            performanceBadge.textContent = "🏆 Outstanding Achievement! Passed with Distinction.";
            performanceBadge.style.color = "#22c55e";
        } else if (percentage >= 60) {
            performanceBadge.textContent = "👏 Well Done! Passed Assessment.";
            performanceBadge.style.color = "var(--COLOR-PRIMARY)";
        } else if (percentage >= 50) {
            performanceBadge.textContent = "👍 Satisfactory Attempt. Minimum threshold met.";
            performanceBadge.style.color = "var(--COLOR-WARNING)";
        } else {
            performanceBadge.textContent = "📚 Needs Improvement. Recommended to review the materials.";
            performanceBadge.style.color = "var(--COLOR-DANGER)";
        }
    }

    // Render answer breakdown
    if (resultDetails.answers && Array.isArray(resultDetails.answers) && reviewCardsContainer) {
        reviewCardsContainer.innerHTML = '';
        if (reviewCountEl) {
            reviewCountEl.textContent = `${score} of ${totalQuestions} correct`;
        }

        resultDetails.answers.forEach(item => {
            const card = document.createElement('div');
            card.className = `review-card ${item.isCorrect ? 'correct' : 'incorrect'}`;

            const header = document.createElement('div');
            header.className = 'review-card__header';

            const title = document.createElement('div');
            title.className = 'review-card__title';
            title.textContent = `${item.number}. ${item.questionText}`;

            const status = document.createElement('span');
            status.className = 'review-card__status';
            status.textContent = item.isCorrect ? '✓ Correct' : '✕ Incorrect';

            header.appendChild(title);
            header.appendChild(status);
            card.appendChild(header);

            const chosen = document.createElement('div');
            chosen.className = 'review-card__detail';
            chosen.innerHTML = `Your answer: <strong>${escapeHtml(item.chosenText)}</strong>`;
            card.appendChild(chosen);

            if (!item.isCorrect && item.correctText) {
                const correct = document.createElement('div');
                correct.className = 'review-card__detail';
                correct.innerHTML = `Correct answer: <strong style="color: #22c55e;">${escapeHtml(item.correctText)}</strong>`;
                card.appendChild(correct);
            }

            reviewCardsContainer.appendChild(card);
        });
    } else if (reviewSection) {
        reviewSection.style.display = 'none';
    }
} else {
    if (percentageScore) percentageScore.textContent = '0%';
    if (reviewSection) reviewSection.style.display = 'none';
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
