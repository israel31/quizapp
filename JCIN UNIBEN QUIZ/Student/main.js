const themeBtn = document.querySelector('.theme'),
     themeIcon = document.querySelector('.theme-icon'),
     introPrompt = document.querySelector('.prompt'),
     mainTest = document.querySelector('.main-test'),
     candidateName = document.querySelectorAll('.candidate-name'),
     candidateEmail = document.querySelector('.candidate-email'),
     toResultPage = document.querySelector('.to-result'),
     submitBtn = document.querySelector('.question-submit-btn'),
     startBtn = document.querySelector('.start');


// Updates the theme icon based on current theme
const updateThemeIcon = () => {
    const isLight = document.body.classList.contains("light-theme");
    themeIcon.textContent = isLight ? "dark_mode" : "light_mode";
}

//Apply light theme if saved or system prefers
const savedTheme = localStorage.getItem("theme");
const systemPrefersLight = window.matchMedia("(prefers-color-scheme:light)").matches;
const shouldUseLightTheme = savedTheme === "light" || (!savedTheme && systemPrefersLight);

document.body.classList.toggle("light-theme", shouldUseLightTheme);

// Toggle between light and dark mode
themeBtn.addEventListener("click", event => {
    const isLight = document.body.classList.toggle("light-theme");
    localStorage.setItem("theme", isLight ? "light" : "dark");
    updateThemeIcon(); 
});

// Retrives students information from localStorage.
const studentInfo = JSON.parse(localStorage.getItem("studentInfo") || "null");

if (studentInfo) {
    console.log(studentInfo);
};

// Setting the displayed name and email to candidate's.

candidateName.forEach(candidateName => {
    candidateName.textContent = `${studentInfo.name}`;
});
candidateEmail.textContent = `${studentInfo.email}`;

// Hide the Prompt when the test beigns
let countdownInterval;

startBtn.addEventListener("click", event => {
    if (countdownInterval) return; // Timer already started

    introPrompt.classList.add("started");
    mainTest.classList.add("started");

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);

});

// Countdown Timer settings
const startingMinutes = 10;
const initialTime = startingMinutes * 60;
let time = initialTime;

const countdownElement = document.querySelector(".countdown");
const questionsForm = document.querySelector(".questions");

const updateCountdown = () => {
    const minutes = Math.floor(time / 60);
    let seconds = time % 60;

    seconds = seconds < 10 ? '0' + seconds : seconds;

    countdownElement.textContent = `${minutes} : ${seconds}`;

    // Add low-time class to timer to change the color of the timer.
    if (time <= (initialTime * 0.2)) {
        const timer = countdownElement.parentElement;
        timer.classList.add("low-time");
    }

    if (time <= 0) {
        clearInterval(countdownInterval);
        questionsForm.requestSubmit();
        return;
    }

    time--;
};

// Adding the check effect on the options picked.
const theQuestionOptions = document.querySelectorAll(".the-options");
const numberOfQuestions = Number(theQuestionOptions.length);

theQuestionOptions.forEach(theOptions => {
    const options = theOptions.querySelectorAll(".option");
    options.forEach(option => {
        
        option.addEventListener("click", event => {
            const isClicked = theOptions.querySelector('.clicked');
            const correctAnswerId = theOptions.querySelector('.answer').id;

            if (isClicked) {
                isClicked.classList.remove("clicked");
            };
            option.classList.add("clicked");

            const choiceId = theOptions.querySelector('.clicked').id;

            if (choiceId === correctAnswerId) {
                score++;
            };
        });
    });
});

// Get score value 
let score = 0; // score counter
let notAttempted = 0; // Not attempted count

questionsForm.addEventListener('submit', event => {
    event.preventDefault();

    calculateScore();

    const resultDetails = {
        score: score,
        notAttempted: notAttempted,
        questionCount: numberOfQuestions,
    };

    console.log(resultDetails);

    localStorage.setItem("resultDetails", JSON.stringify(resultDetails));

    window.location.href = "./result.html";
});


const calculateScore = () => {
    score = 0;
    notAttempted = 0;

    theQuestionOptions.forEach(theOptions => {

        const correctAnswer = theOptions.querySelector('.answer');
        const correctAnswerId = correctAnswer.id;

        const choice = theOptions.querySelector('.clicked');
        let choiceId = 0;

        if (choice) {
            choiceId = choice.id;
        }
        
        if (!choice) {
            notAttempted++;
        }
        if (choiceId === correctAnswerId) {
            score++;
        };

    });
};