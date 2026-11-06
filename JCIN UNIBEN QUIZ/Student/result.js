const themeBtn = document.querySelector('.theme'),
     themeIcon = document.querySelector('.theme-icon'),
     candidateName = document.querySelector('.candidate-name'),
     candidateEmail = document.querySelector('.candidate-email'),
     studentScore = document.querySelector('.score-amount'),
     percentageScore = document.querySelector('.percentage-score'),
     failedScore = document.querySelector('.failed-amount'),
     numAttempted = document.querySelector('.num-attempted'),
     numNotAttempted = document.querySelector('.mun-not-attempted');


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

candidateName.textContent = `${studentInfo.name}`;
candidateEmail.textContent = `${studentInfo.email}`;


// Retrives Result information from localStorage.
const resultDetails = JSON.parse(localStorage.getItem("resultDetails") || "null");

// Setting the displayed values

const percentageValue = Math.round((resultDetails.score / resultDetails.questionCount) * 100);

studentScore.textContent = `${resultDetails.score}`;
percentageScore.textContent = `${percentageValue}%`;
failedScore.textContent = `${(resultDetails.questionCount - resultDetails.score)}`;
numAttempted.textContent = `${(resultDetails.questionCount - resultDetails.notAttempted)}`;
numNotAttempted.textContent = `${resultDetails.notAttempted}`;

