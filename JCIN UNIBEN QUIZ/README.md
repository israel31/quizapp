# JCIN UNIBEN Student Quiz

A static, browser-based quiz for intending members of JCIN UNIBEN. Students enter their name and email, complete a timed multiple-choice test, and view a summary of their results.

## Features

- Login page for collecting a student's name and email
- Client-side input and email-format validation
- Forty multiple-choice questions, with one selectable answer per question
- Ten-minute countdown; the quiz submits automatically when time expires
- Result summary showing correct answers, the percentage score, failed answers, attempted questions, and unanswered questions
- Light and dark themes; the selected theme is saved in browser storage
- Shared responsive styling across the login, quiz, and results pages

## Project layout

```text
.
├── README.md
└── Student/
    ├── index.html    # Login page
    ├── login.js      # Login validation, theme, and student data
    ├── test.html     # Quiz form and question markup
    ├── main.js       # Theme, answer selection, timer, scoring, and submission
    ├── result.html   # Results page structure
    ├── result.js     # Loads and displays saved student and result data
    └── style.css     # Shared styles and responsive layout
```

## Run the project locally

The project has no build step or package dependencies. It is a static website. Running it through a local web server is recommended so all pages use the same origin and can read the same `localStorage` values.

From the project root, start Python's built-in server:

```powershell
python -m http.server 8000 --directory Student
```

Then open [http://localhost:8000](http://localhost:8000) in a browser. If the `python` command is unavailable, try `py -m http.server 8000 --directory Student`.

To take the test:

1. Enter a name and email on the login page, then select **LOGIN**.
2. Select **START** to show the quiz and begin the countdown.
3. Select one answer for each question. You can change an answer by selecting another option in the same question.
4. Select **SUBMIT**, or let the timer reach zero to submit automatically.
5. Review the result summary.

Stop the local server with `Ctrl+C` in the terminal where it is running. Opening the HTML files directly may work in some browsers, but `localStorage` behavior for `file:` URLs can vary.

## How the pages work together

### Login — `Student/index.html` and `Student/login.js`

The login form collects the student's name and email. The script prevents the form's default page reload, validates the inputs, stores the student details as JSON under the `studentInfo` key, and opens `test.html`.

### Quiz — `Student/test.html` and `Student/main.js`

The quiz page reads the saved student details and displays the name and email. The timer starts only after **START** is clicked and is configured for ten minutes in `main.js`. The start handler guards against starting another interval while the timer is already running.

Each question's answer choices are grouped in a `.the-options` element. Selecting an option marks it with the `.clicked` class, replacing any previous selection for that question. The correct choice is identified by the `.answer` class.

Manual submission and timer expiry both submit the quiz form. The submit handler recalculates the score, saves the result data under the `resultDetails` key, and navigates to `result.html`.

### Results — `Student/result.html` and `Student/result.js`

The results script reads the saved student and result data, then fills in the student's details and result breakdown. It calculates the percentage as the rounded score divided by the total question count.

## Browser storage

The site uses `localStorage`, scoped to the browser and site origin. The data is not sent to a server.

| Key | Contents |
| --- | --- |
| `studentInfo` | Student name and email |
| `resultDetails` | Correct score, unanswered count, and total question count |
| `theme` | Saved theme choice: `light` or `dark` |

Use the same browser and local server origin for the login, quiz, and results pages. Clearing the browser's site data removes these saved values. A different browser or device has separate storage.

## Updating quiz content and settings

- **Add or remove questions:** edit the question markup in `Student/test.html`. The script counts `.the-options` elements to determine the total number of questions.
- **Mark the correct choice:** ensure each question has exactly one option with the `.answer` class.
- **Keep option IDs consistent:** the current scoring logic compares the selected option's `id` with the correct option's `id`. IDs can repeat across different questions, but each option in a given question should have a distinct ID.
- **Change the test duration:** change `startingMinutes` in `Student/main.js`; for example, `10` means ten minutes.
- **Change the appearance:** update `Student/style.css`, including its CSS theme variables and responsive rules.
- **Change the results summary:** update the matching markup in `Student/result.html` and selectors/calculations in `Student/result.js`.

## Current limitations

- This is a front-end project with no server, user accounts, central results database, or cross-device synchronization.
- Answers and results are stored and processed in the browser, so this is not suitable for a high-stakes or tamper-resistant examination.
- Name and email validation is client-side only; there is no server-side validation.
- The results page expects student and result data to already exist in `localStorage`; opening it directly or after clearing site data may prevent it from displaying correctly.
- Poppins and Material Symbols are loaded from Google, so those fonts/icons require an internet connection. The stylesheet includes fallback text fonts.
