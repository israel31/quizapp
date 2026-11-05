// @ts-check
/**
 * Student Quiz Controller (main.js)
 * Fully connected with the JCIN UNIBEN Quiz Platform.
 * Loads quizzes, manages timed sessions, records submissions into the platform store.
 */

const themeBtn = document.querySelector('.theme'),
     themeIcon = document.querySelector('.theme-icon'),
     introPrompt = document.querySelector('.prompt'),
     mainTest = document.querySelector('.main-test'),
     candidateName = document.querySelectorAll('.candidate-name'),
     candidateEmail = document.querySelector('.candidate-email'),
     quizTitleEl = document.querySelector('.quiz-title'),
     quizInstructionEl = document.querySelector('.quiz-instruction'),
     activeBadgeEl = document.querySelector('.active-quiz-badge'),
     countdownElement = document.querySelector('.countdown'),
     questionsForm = document.querySelector('.questions'),
     startBtn = document.querySelector('.start');

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

// Retrieve student information from localStorage
const studentInfo = JSON.parse(localStorage.getItem("studentInfo") || "null");
if (!studentInfo || !studentInfo.name) {
    window.location.href = "./index.html";
}

// Display candidate information
if (studentInfo) {
    candidateName.forEach(el => { el.textContent = studentInfo.name; });
    if (candidateEmail) candidateEmail.textContent = studentInfo.email;
}

// Determine active quiz from URL or localStorage
const urlParams = new URLSearchParams(window.location.search);
const requestedQuizId = urlParams.get('quiz') || localStorage.getItem('selectedQuizId');

/** @type {any} */
let activeQuiz = null;
let startingMinutes = 10;
let isDynamicQuiz = false;

try {
    const storedQuizzes = JSON.parse(localStorage.getItem('jci-mock:quizzes') || '[]');
    if (storedQuizzes && storedQuizzes.length > 0) {
        if (requestedQuizId && requestedQuizId !== 'default') {
            activeQuiz = storedQuizzes.find(q => q.id === requestedQuizId) || null;
        }
        if (!activeQuiz) {
            // Find JCI Uniben General Knowledge or first published
            activeQuiz = storedQuizzes.find(q => q.title.toLowerCase().includes('general knowledge') || q.title.toLowerCase().includes('intending'))
                || storedQuizzes.find(q => q.status === 'published')
                || storedQuizzes[0];
        }
    }
} catch {
    // Keep fallback
}

if (activeQuiz) {
    if (quizTitleEl) quizTitleEl.textContent = activeQuiz.title;
    if (quizInstructionEl && (activeQuiz.description || activeQuiz.instructions)) {
        quizInstructionEl.textContent = activeQuiz.description || activeQuiz.instructions;
    }
    if (activeBadgeEl) {
        activeBadgeEl.textContent = `Quiz: ${activeQuiz.title}`;
    }
    if (activeQuiz.settings?.durationMinutes) {
        startingMinutes = Number(activeQuiz.settings.durationMinutes) || 10;
    }

    // If quiz is not the standard 40-question general knowledge, render questions dynamically
    if (activeQuiz.questions && activeQuiz.questions.length > 0 && activeQuiz.id && !activeQuiz.title.toLowerCase().includes('general knowledge')) {
        renderDynamicQuestions(activeQuiz.questions);
        isDynamicQuiz = true;
    }
} else {
    if (activeBadgeEl) activeBadgeEl.textContent = 'Quiz: JCI Uniben General Knowledge';
}

function renderDynamicQuestions(questions) {
    if (!questionsForm) return;
    questionsForm.innerHTML = '';
    
    questions.forEach((q, index) => {
        const qDiv = document.createElement('div');
        qDiv.className = 'question';
        qDiv.dataset.questionId = q.id;

        const p = document.createElement('p');
        p.textContent = `${index + 1}. ${q.text}`;
        qDiv.appendChild(p);

        const ul = document.createElement('ul');
        ul.className = 'the-options';
        ul.dataset.questionId = q.id;

        (q.options || []).forEach((opt, optIndex) => {
            const letter = String.fromCharCode(65 + optIndex);
            const li = document.createElement('li');
            li.className = 'option' + (opt.isCorrect ? ' answer' : '');
            li.dataset.optionId = opt.id;
            li.textContent = `${letter}. ${opt.text}`;
            ul.appendChild(li);
        });

        qDiv.appendChild(ul);
        questionsForm.appendChild(qDiv);
    });

    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    submitBtn.className = 'question-submit-btn';
    submitBtn.textContent = 'SUBMIT';
    questionsForm.appendChild(submitBtn);
}

// Timer and Session Setup
const initialTime = startingMinutes * 60;
let time = initialTime;
let countdownInterval;
let sessionStartTime = Date.now();

// Display initial timer formatted
if (countdownElement) {
    const initMin = Math.floor(initialTime / 60);
    const initSec = initialTime % 60;
    countdownElement.textContent = `${initMin < 10 ? '0' + initMin : initMin} : ${initSec < 10 ? '0' + initSec : initSec}`;
}

const updateCountdown = () => {
    const minutes = Math.floor(time / 60);
    let seconds = time % 60;
    const formattedSeconds = seconds < 10 ? '0' + seconds : String(seconds);
    const formattedMinutes = minutes < 10 ? '0' + minutes : String(minutes);

    if (countdownElement) {
        countdownElement.textContent = `${formattedMinutes} : ${formattedSeconds}`;

        if (time <= (initialTime * 0.2)) {
            const timerContainer = countdownElement.parentElement;
            if (timerContainer) timerContainer.classList.add("low-time");
        }
    }

    if (time <= 0) {
        clearInterval(countdownInterval);
        if (questionsForm) questionsForm.requestSubmit();
        return;
    }

    time--;
};

// Start Assessment
if (startBtn) {
    startBtn.addEventListener("click", () => {
        if (countdownInterval) return;

        sessionStartTime = Date.now();
        if (introPrompt) introPrompt.classList.add("started");
        if (mainTest) mainTest.classList.add("started");

        updateCountdown();
        countdownInterval = setInterval(updateCountdown, 1000);
    });
}

// Option selection handler with event delegation
if (questionsForm) {
    questionsForm.addEventListener("click", event => {
        const target = /** @type {HTMLElement} */ (event.target);
        const option = target.closest(".option");
        if (!option) return;

        const optionsGroup = option.closest(".the-options");
        if (!optionsGroup) return;

        const currentlyClicked = optionsGroup.querySelector(".clicked");
        if (currentlyClicked) {
            currentlyClicked.classList.remove("clicked");
        }
        option.classList.add("clicked");
    });
}

// Submission and Scoring
if (questionsForm) {
    questionsForm.addEventListener("submit", event => {
        event.preventDefault();
        clearInterval(countdownInterval);

        const theQuestionOptions = document.querySelectorAll(".the-options");
        const totalQuestions = theQuestionOptions.length;

        let score = 0;
        let notAttempted = 0;
        /** @type {any[]} */
        const reviewAnswers = [];
        /** @type {any[]} */
        const backendAnswers = [];

        theQuestionOptions.forEach((theOptions, qIdx) => {
            const questionEl = theOptions.closest(".question");
            const qTitle = questionEl?.querySelector("p")?.textContent?.replace(/^\d+\.\s*/, "").trim() || `Question ${qIdx + 1}`;
            const questionId = theOptions.getAttribute("data-question-id") || theOptions.id || String(qIdx + 1);

            const correctAnswerEl = theOptions.querySelector(".answer");
            const correctAnswerText = correctAnswerEl?.textContent?.replace(/^[A-Z]\.\s*/, "").trim() || "";
            const correctAnswerId = correctAnswerEl?.getAttribute("data-option-id") || correctAnswerEl?.id || "";

            const chosenEl = theOptions.querySelector(".clicked");
            const chosenText = chosenEl?.textContent?.replace(/^[A-Z]\.\s*/, "").trim() || null;
            const chosenId = chosenEl?.getAttribute("data-option-id") || chosenEl?.id || null;

            let isCorrect = false;
            if (!chosenEl) {
                notAttempted++;
            } else if (chosenId && correctAnswerId && chosenId === correctAnswerId) {
                isCorrect = true;
                score++;
            } else if (chosenText && correctAnswerText && chosenText.toLowerCase() === correctAnswerText.toLowerCase()) {
                isCorrect = true;
                score++;
            }

            reviewAnswers.push({
                number: qIdx + 1,
                questionText: qTitle,
                chosenText: chosenText || "No answer selected",
                correctText: correctAnswerText,
                isCorrect: isCorrect
            });

            backendAnswers.push({
                questionId: questionId,
                selectedOptionIds: chosenId ? [chosenId] : [],
                text: chosenText,
                autoMarks: isCorrect ? 1 : 0,
                manualMarks: null,
                feedback: null,
                needsManualGrading: false
            });
        });

        const activeQuizId = activeQuiz?.id || 'quiz-general-knowledge';
        const activeQuizTitle = activeQuiz?.title || 'JCI Uniben General Knowledge';

        // Record the attempt into the platform's mock storage (jci-mock:attempts)
        try {
            const existingAttempts = JSON.parse(localStorage.getItem('jci-mock:attempts') || '[]');
            const attemptId = 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);

            const studentEmail = (studentInfo.email || '').trim().toLowerCase();
            const studentName = (studentInfo.name || 'Candidate').trim();

            const newAttempt = {
                id: attemptId,
                quizId: activeQuizId,
                participant: {
                    id: 'part-' + (studentEmail ? btoa(studentEmail).replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) : Date.now()),
                    name: studentName,
                    email: studentEmail
                },
                attemptNumber: existingAttempts.filter(a => a.quizId === activeQuizId && a.participant?.email === studentEmail).length + 1,
                status: 'graded',
                startedAt: new Date(sessionStartTime).toISOString(),
                submittedAt: new Date().toISOString(),
                score: score,
                maxScore: totalQuestions,
                isFinal: true,
                answers: backendAnswers
            };

            existingAttempts.unshift(newAttempt);
            localStorage.setItem('jci-mock:attempts', JSON.stringify(existingAttempts));

            // Increment attempt count on the quiz in jci-mock:quizzes
            const allQuizzes = JSON.parse(localStorage.getItem('jci-mock:quizzes') || '[]');
            const qIdx = allQuizzes.findIndex(q => q.id === activeQuizId || q.title === activeQuizTitle);
            if (qIdx !== -1) {
                allQuizzes[qIdx].attemptCount = (Number(allQuizzes[qIdx].attemptCount) || 0) + 1;
                allQuizzes[qIdx].updatedAt = new Date().toISOString();
                localStorage.setItem('jci-mock:quizzes', JSON.stringify(allQuizzes));
            }
        } catch (e) {
            console.warn("Could not save attempt to shared platform store:", e);
        }

        // Save detailed results for student's result page
        const resultDetails = {
            score: score,
            notAttempted: notAttempted,
            questionCount: totalQuestions,
            quizTitle: activeQuizTitle,
            quizId: activeQuizId,
            submittedAt: new Date().toISOString(),
            answers: reviewAnswers
        };

        localStorage.setItem("resultDetails", JSON.stringify(resultDetails));
        window.location.href = "./result.html";
    });
}
