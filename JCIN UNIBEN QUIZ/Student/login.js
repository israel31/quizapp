const candidateName = document.querySelector('.name'),
     candidateEmail = document.querySelector('.email'),
     quiz = document.querySelector('.quiz-link'),
     themeBtn = document.querySelector('.theme'),
     themeIcon = document.querySelector('.theme-icon'),
     studentLoginFrom = document.querySelector('.login-form');

let errorCount = 0;

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

studentLoginFrom.addEventListener("submit", event =>  {
    event.preventDefault();

    validateInputs();

    if (errorCount === 0) {

        // Sharing the student info to the enteir website.
        const studentData = { 
            name: candidateName.value.trim(),
            email: candidateEmail.value.trim()
        }

        localStorage.setItem("studentInfo", JSON.stringify(studentData));

        quiz.click();
    }

});

const setError = (element, message) => {
    const inputBox = element.parentElement;
    const errorDisplay = inputBox.querySelector('.error');

    errorDisplay.textContent = message;
    inputBox.classList.add("fail");

    element.addEventListener('click', event => {
        inputBox.classList.remove("fail");
    });
}

const validateEmail = (email) => {
    const regex = /^([a-z\d\.-]+)@([a-z\d-]+)\.([a-z]{2,8})(\.[a-z]{2,8})?$/g;
    const isValid = regex.test(email.trim().toLowerCase());
    return isValid;
}

const validateInputs = () => {
    errorCount = 0; // Starts the count from zero after every submission
    const candidateNameValue =  candidateName.value.trim();
    const candidateEmailValue =  candidateEmail.value.trim().toLowerCase();

    

    if(candidateNameValue === "") { // verifies name
        setError(candidateName, "Your full name is required");
        errorCount++;
    }

    if (candidateEmailValue === "") { // verifies email
        setError(candidateEmail, "Email is required");
        errorCount++;
    } else if (!validateEmail(candidateEmailValue)) {
        setError(candidateEmail, "Invalid Email address");
        errorCount++;
    }

}