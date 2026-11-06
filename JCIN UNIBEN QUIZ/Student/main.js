
// ========================================
// JCIN UNIBEN QUIZ - STUDENT CONTROLLER
// ========================================

const SUPABASE_URL = "https://eroogvrsmlfpcdmnvxsf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EwKWVrQlbM7EzmKVdKHS_Q_nHSKigzb";
const STUDENT_API = `${SUPABASE_URL}/functions/v1/quiz-student`;

const themeBtn = document.querySelector(".theme");
const themeIcon = document.querySelector(".theme-icon");
const introPrompt = document.querySelector(".prompt");
const mainTest = document.querySelector(".main-test");
const candidateNameEls = document.querySelectorAll(".candidate-name");
const candidateEmailEl = document.querySelector(".candidate-email");
const quizTitleEl = document.querySelector(".quiz-title");
const quizInstructionEl = document.querySelector(".quiz-instruction");
const activeBadgeEl = document.querySelector(".active-quiz-badge");
const countdownElement = document.querySelector(".countdown");
const questionsForm = document.querySelector(".questions");
const startBtn = document.querySelector(".start");

const studentInfo = JSON.parse(localStorage.getItem("studentInfo") || "null");
const params = new URLSearchParams(window.location.search);
const quizId = params.get("quiz") || localStorage.getItem("selectedQuizId");

if (!studentInfo?.name || !studentInfo?.email || !quizId) {
    window.location.href = "./index.html";
}

candidateNameEls.forEach(el => {
    el.textContent = studentInfo?.name || "";
});

if (candidateEmailEl) {
    candidateEmailEl.textContent = studentInfo?.email || "";
}

let activeQuiz = null;
let attempt = null;
let resumeToken = null;
let questions = [];
let savedAnswers = {};
let expiresAt = null;
let countdownInterval = null;
let saveQueue = Promise.resolve();
let submitting = false;

const SESSION_KEY = `jcin_quiz_attempt_${quizId}`;
const ANSWERS_KEY = `jcin_quiz_answers_${quizId}`;

// ----------------------------------------
// API
// ----------------------------------------

async function studentRequest(action, payload = {}) {
    const response = await fetch(STUDENT_API, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ action, ...payload })
    });

    const data = await response.json();

    if (!response.ok) {
        const error = new Error(data.error || "Something went wrong.");
        error.status = response.status;
        error.data = data;
        throw error;
    }

    return data;
}

function showMessage(message) {
    let el = document.querySelector(".student-message");

    if (!el) {
        el = document.createElement("p");
        el.className = "student-message";
        el.style.color = "#ef4444";
        el.style.padding = "12px";
        el.style.textAlign = "center";
        (introPrompt || mainTest)?.prepend(el);
    }

    el.textContent = message;
}

// ----------------------------------------
// THEME
// ----------------------------------------

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

// ----------------------------------------
// LOAD QUIZ
// ----------------------------------------

async function loadQuiz() {
    try {
        const data = await studentRequest("get_quiz", { quizId });
        activeQuiz = data.quiz;
        questions = activeQuiz.questions || [];

        if (quizTitleEl) quizTitleEl.textContent = activeQuiz.title;
        if (quizInstructionEl) {
            quizInstructionEl.textContent =
                activeQuiz.instructions ||
                activeQuiz.description ||
                "Click on the start button to begin your test.";
        }

        if (activeBadgeEl) {
            activeBadgeEl.textContent = `Quiz: ${activeQuiz.title}`;
        }

        const existingSession = getSavedSession();

        if (existingSession?.attemptId && existingSession?.resumeToken) {
            await resumeAttempt(existingSession);
        }
    } catch (error) {
        console.error("Quiz loading failed:", error);
        showMessage(error.message || "Unable to load this quiz.");
        if (startBtn) startBtn.disabled = true;
    }
}

function getSavedSession() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    } catch {
        return null;
    }
}

function storeSession() {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
        attemptId: attempt.id,
        resumeToken
    }));
}

function storeLocalAnswers() {
    localStorage.setItem(ANSWERS_KEY, JSON.stringify(savedAnswers));
}

// ----------------------------------------
// RENDER QUESTIONS
// ----------------------------------------

function renderQuestions() {
    if (!questionsForm) return;

    questionsForm.innerHTML = "";

    questions.forEach((question, index) => {
        const questionDiv = document.createElement("div");
        questionDiv.className = "question";
        questionDiv.dataset.questionId = question.id;

        const title = document.createElement("p");
        title.textContent = `${index + 1}. ${question.text}`;
        questionDiv.appendChild(title);

        if (question.image?.url) {
            const image = document.createElement("img");
            image.src = question.image.url;
            image.alt = "Question image";
            image.style.maxWidth = "100%";
            image.style.height = "auto";
            questionDiv.appendChild(image);
        }

        if (
            question.type === "multiple_choice" ||
            question.type === "checkboxes"
        ) {
            const list = document.createElement("ul");
            list.className = "the-options";
            list.dataset.questionId = question.id;
            list.dataset.questionType = question.type;

            (question.options || []).forEach((option, optionIndex) => {
                const li = document.createElement("li");
                li.className = "option";
                li.dataset.optionId = option.id;

                const letter = String.fromCharCode(65 + optionIndex);
                li.textContent = `${letter}. ${option.option_text ?? option.text ?? ""}`;

                const selectedIds =
                    savedAnswers[question.id]?.selectedOptionIds || [];

                if (selectedIds.includes(option.id)) {
                    li.classList.add("clicked");
                }

                list.appendChild(li);
            });

            questionDiv.appendChild(list);
        } else {
            const input = question.type === "paragraph"
                ? document.createElement("textarea")
                : document.createElement("input");

            input.className = "student-text-answer";
            input.dataset.questionId = question.id;
            input.maxLength = Number(question.maxLength) || 5000;
            input.placeholder = question.type === "paragraph"
                ? "Type your answer here..."
                : "Enter your answer";

            if (question.type === "paragraph") {
                input.rows = 5;
            } else {
                input.type = "text";
            }

            input.style.width = "100%";
            input.style.padding = "12px";
            input.style.marginTop = "12px";
            input.style.borderRadius = "8px";

            input.value = savedAnswers[question.id]?.text || "";

            questionDiv.appendChild(input);
        }

        questionsForm.appendChild(questionDiv);
    });

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "question-submit-btn";
    submitBtn.textContent = "SUBMIT";
    questionsForm.appendChild(submitBtn);
}

function collectAnswers() {
    const result = [];

    questions.forEach(question => {
        const saved = savedAnswers[question.id] || {};

        result.push({
            questionId: question.id,
            selectedOptionIds: saved.selectedOptionIds || [],
            text: saved.text || ""
        });
    });

    return result;
}

// ----------------------------------------
// ANSWER INTERACTION
// ----------------------------------------

questionsForm?.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const option = target.closest(".option");
    if (!option) return;

    const group = option.closest(".the-options");
    if (!group) return;

    const questionId = group.dataset.questionId;
    const questionType = group.dataset.questionType;

    if (!questionId) return;

    const optionId = option.dataset.optionId;
    if (!optionId) return;

    if (!savedAnswers[questionId]) {
        savedAnswers[questionId] = {
            selectedOptionIds: [],
            text: ""
        };
    }

    let selected = savedAnswers[questionId].selectedOptionIds || [];

    if (questionType === "checkboxes") {
        selected = selected.includes(optionId)
            ? selected.filter(id => id !== optionId)
            : [...selected, optionId];
    } else {
        selected = [optionId];
    }

    savedAnswers[questionId].selectedOptionIds = selected;

    group.querySelectorAll(".option").forEach(item => {
        item.classList.toggle(
            "clicked",
            selected.includes(item.dataset.optionId)
        );
    });

    storeLocalAnswers();
    queueSaveAnswers();
});

questionsForm?.addEventListener("input", event => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement) &&
        !(target instanceof HTMLTextAreaElement)) return;

    if (!target.classList.contains("student-text-answer")) return;

    const questionId = target.dataset.questionId;
    if (!questionId) return;

    if (!savedAnswers[questionId]) {
        savedAnswers[questionId] = {
            selectedOptionIds: [],
            text: ""
        };
    }

    savedAnswers[questionId].text = target.value;

    storeLocalAnswers();
    queueSaveAnswers();
});

// ----------------------------------------
// SAVE ANSWERS
// ----------------------------------------

function queueSaveAnswers() {
    if (!attempt || !resumeToken || submitting) return;

    const answersSnapshot = collectAnswers();

    saveQueue = saveQueue
        .then(async () => {
            await studentRequest("save_answers", {
                attemptId: attempt.id,
                resumeToken,
                answers: answersSnapshot
            });
        })
        .catch(error => {
            console.error("Answer autosave failed:", error);
        });
}

// ----------------------------------------
// START ATTEMPT
// ----------------------------------------

async function startAttempt() {
    if (!activeQuiz || !startBtn) return;

    startBtn.disabled = true;
    startBtn.textContent = "STARTING...";

    try {
        const data = await studentRequest("start_attempt", {
            quizId,
            name: studentInfo.name,
            email: studentInfo.email
        });

        attempt = data.attempt;
        resumeToken = data.resumeToken;
        activeQuiz = data.quiz;
        questions = activeQuiz.questions || [];
        expiresAt = new Date(attempt.expires_at).getTime();

        savedAnswers = {};

        storeSession();
        storeLocalAnswers();
        renderQuestions();
        beginQuizInterface();
    } catch (error) {
        console.error("Could not start attempt:", error);

        if (error.status === 409) {
            showMessage(
                "An attempt is already in progress. If you started this quiz before, return to the same browser session to resume it."
            );
        } else {
            showMessage(error.message || "Unable to start this quiz.");
        }

        startBtn.disabled = false;
        startBtn.textContent = "START";
    }
}

// ----------------------------------------
// RESUME ATTEMPT
// ----------------------------------------

async function resumeAttempt(session) {
    try {
        const data = await studentRequest("resume_attempt", {
            attemptId: session.attemptId,
            resumeToken: session.resumeToken
        });

        attempt = data.attempt;
        resumeToken = session.resumeToken;
        activeQuiz = data.quiz;
        questions = activeQuiz.questions || [];
        expiresAt = new Date(attempt.expires_at).getTime();

        savedAnswers = {};

        (data.answers || []).forEach(answer => {
            savedAnswers[answer.question_id] = {
                selectedOptionIds: answer.selected_option_ids || [],
                text: answer.response_text || ""
            };
        });

        storeLocalAnswers();
        renderQuestions();
        beginQuizInterface();
    } catch (error) {
        console.error("Could not resume attempt:", error);

        if (error.status === 410) {
            attempt = {
                id: session.attemptId,
                expires_at: new Date().toISOString()
            };
            resumeToken = session.resumeToken;

            try {
                savedAnswers = JSON.parse(
                    localStorage.getItem(ANSWERS_KEY) || "{}"
                );
            } catch {
                savedAnswers = {};
            }

            renderQuestions();
            await submitAttempt(true);
            return;
        }

        showMessage(
            error.message ||
            "Your previous quiz session could not be restored."
        );

        localStorage.removeItem(SESSION_KEY);
    }
}

// ----------------------------------------
// START QUIZ INTERFACE
// ----------------------------------------

function beginQuizInterface() {
    if (introPrompt) introPrompt.classList.add("started");
    if (mainTest) mainTest.classList.add("started");

    if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = "IN PROGRESS";
    }

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
}

function updateCountdown() {
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));

    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    if (countdownElement) {
        countdownElement.textContent =
            `${String(minutes).padStart(2, "0")} : ${String(seconds).padStart(2, "0")}`;

        if (remaining <= 300) {
            countdownElement.parentElement?.classList.add("low-time");
        }
    }

    if (remaining <= 0) {
        clearInterval(countdownInterval);
        submitAttempt(true);
    }
}

// ----------------------------------------
// SUBMIT
// ----------------------------------------

questionsForm?.addEventListener("submit", async event => {
    event.preventDefault();

    if (submitting) return;

    const confirmed = window.confirm(
        "Are you sure you want to submit your assessment?"
    );

    if (!confirmed) return;

    await submitAttempt(false);
});

async function submitAttempt(isAutomatic = false) {
    if (!attempt || !resumeToken || submitting) return;

    submitting = true;
    clearInterval(countdownInterval);

    const submitButton = questionsForm?.querySelector(
        'button[type="submit"]'
    );

    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = "SUBMITTING...";
    }

    if (startBtn) startBtn.disabled = true;

    try {
        await saveQueue;

        const data = await studentRequest("submit_attempt", {
            attemptId: attempt.id,
            resumeToken,
            answers: collectAnswers()
        });

        localStorage.setItem("lastSubmittedAttemptId", attempt.id);
        localStorage.setItem("lastSubmittedResumeToken", resumeToken);

        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem(ANSWERS_KEY);

        window.location.href = "./result.html";
    } catch (error) {
        console.error("Submission failed:", error);

        submitting = false;

        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "SUBMIT";
        }

        if (isAutomatic) {
            showMessage(
                "Your time has expired, but submission could not be confirmed. Please try submitting again."
            );
        } else {
            showMessage(error.message || "Unable to submit your assessment.");
        }
    }
}

startBtn?.addEventListener("click", startAttempt);

// ----------------------------------------
// INITIALIZE
// ----------------------------------------

loadQuiz();
