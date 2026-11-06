
const SUPABASE_URL = "https://eroogvrsmlfpcdmnvxsf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_EwKWVrQlbM7EzmKVdKHS_Q_nHSKigzb";
const STUDENT_API = `${SUPABASE_URL}/functions/v1/quiz-student`;

const candidateName = document.querySelector(".name");
const candidateEmail = document.querySelector(".email");
const studentLoginForm = document.querySelector(".login-form");
const quizSelect = document.querySelector("#quizSelect");
const themeBtn = document.querySelector(".theme");
const themeIcon = document.querySelector(".theme-icon");

let availableQuizzes = [];

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
        throw new Error(data.error || "Something went wrong.");
    }

    return data;
}

// Theme
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

function showMessage(message, type = "error") {
    let messageEl = document.querySelector(".student-message");

    if (!messageEl) {
        messageEl = document.createElement("p");
        messageEl.className = "student-message";
        studentLoginForm?.appendChild(messageEl);
    }

    messageEl.textContent = message;
    messageEl.style.marginTop = "12px";
    messageEl.style.fontSize = "0.9rem";
    messageEl.style.color = type === "error" ? "#ef4444" : "#16a34a";
}

function setLoading(isLoading) {
    const button = studentLoginForm?.querySelector('button[type="submit"]');
    if (!button) return;

    button.disabled = isLoading;
    button.textContent = isLoading ? "LOADING QUIZZES..." : "START ASSESSMENT";
}

async function loadAvailableQuizzes() {
    if (!quizSelect) return;

    quizSelect.innerHTML = '<option value="">Loading available quizzes...</option>';
    quizSelect.disabled = true;

    try {
        const data = await studentRequest("list_quizzes");
        availableQuizzes = data.items || [];

        quizSelect.innerHTML = "";

        if (!availableQuizzes.length) {
            quizSelect.innerHTML = '<option value="">No published quizzes available</option>';
            showMessage("There are currently no published quizzes available.");
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const requestedQuizId =
            params.get("quiz") || localStorage.getItem("selectedQuizId");

        availableQuizzes.forEach(quiz => {
            const option = document.createElement("option");
            option.value = quiz.id;

            const duration = quiz.durationMinutes
                ? ` • ${quiz.durationMinutes} minutes`
                : "";

            option.textContent = `${quiz.title}${duration}`;

            if (quiz.availability !== "open") {
                option.disabled = true;
                option.textContent += quiz.availability === "scheduled"
                    ? " (Not yet open)"
                    : " (Closed)";
            }

            if (requestedQuizId === quiz.id) {
                option.selected = true;
            }

            quizSelect.appendChild(option);
        });

        if (!quizSelect.value || quizSelect.selectedOptions[0]?.disabled) {
            const firstAvailable = availableQuizzes.find(q => q.availability === "open");
            if (firstAvailable) quizSelect.value = firstAvailable.id;
        }

        quizSelect.disabled = false;
    } catch (error) {
        console.error("Quiz loading error:", error);
        quizSelect.innerHTML = '<option value="">Unable to load quizzes</option>';
        showMessage(error.message || "Unable to load available quizzes.");
    }
}

function validateInputs() {
    let valid = true;

    const name = candidateName?.value.trim() || "";
    const email = candidateEmail?.value.trim().toLowerCase() || "";

    document.querySelectorAll(".input-box").forEach(box => {
        box.classList.remove("fail");
        const error = box.querySelector(".error");
        if (error) error.textContent = "";
    });

    if (!name) {
        valid = false;
        const box = candidateName?.parentElement;
        box?.classList.add("fail");
        const error = box?.querySelector(".error");
        if (error) error.textContent = "Your full name is required";
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email) {
        valid = false;
        const box = candidateEmail?.parentElement;
        box?.classList.add("fail");
        const error = box?.querySelector(".error");
        if (error) error.textContent = "Email is required";
    } else if (!emailRegex.test(email)) {
        valid = false;
        const box = candidateEmail?.parentElement;
        box?.classList.add("fail");
        const error = box?.querySelector(".error");
        if (error) error.textContent = "Enter a valid email address";
    }

    if (!quizSelect?.value) {
        valid = false;
        showMessage("Please select an available quiz.");
    }

    return valid;
}

studentLoginForm?.addEventListener("submit", event => {
    event.preventDefault();

    if (!validateInputs()) return;

    const selectedQuiz = availableQuizzes.find(
        quiz => quiz.id === quizSelect.value
    );

    if (!selectedQuiz || selectedQuiz.availability !== "open") {
        showMessage("This quiz is not currently available.");
        return;
    }

    const studentInfo = {
        name: candidateName.value.trim(),
        email: candidateEmail.value.trim().toLowerCase()
    };

    localStorage.setItem("studentInfo", JSON.stringify(studentInfo));
    localStorage.setItem("selectedQuizId", selectedQuiz.id);

    // Do not discard an existing attempt session for this quiz.
    window.location.href = `./test.html?quiz=${encodeURIComponent(selectedQuiz.id)}`;
});

loadAvailableQuizzes();
