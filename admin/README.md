# JCI Uniben Quiz Admin — admin website (frontend only)

The website JCI Uniben administrators use to create, publish, manage and grade quizzes.
It is **only the admin frontend**: plain HTML, CSS and JavaScript (ES modules), no frameworks and no build step.
The backend (database, APIs, login, grading, image storage) and the participant section (where people take quizzes) are built by other developers. Anyone with an account can take a quiz, so this site calls them **participants**.

**Current status: Stages 1–11 done.** The one step left is connecting the real backend when it's ready ([checklist](#connecting-the-real-backend)). See [Build stages](#build-stages).

**Contents:** [Running it locally](#running-it-locally) · [Connecting the real backend](#connecting-the-real-backend) · [Deploying](#deploying) · [Handoff: backend developer](#handoff-backend-developer) · [Handoff: participant-section developer](#handoff-participant-section-developer) · [Decisions](#decisions) · [What each stage built](#what-each-stage-built) · [File structure](#file-structure) · [Build stages](#build-stages) · [Testing](#testing) · [Accessibility and screen sizes](#accessibility-and-screen-sizes) · [Token additions](#token-additions-please-approve-or-change) · [Risks](#risks-and-things-to-settle-early) · [Security notes](#security-notes-frontend-side)

---

## Running it locally

Because the JavaScript uses ES modules (`<script type="module">`), browsers refuse to load it from a file you double-click.
Open the folder through a small local web server instead — any one of these works:

| Tool | How |
| --- | --- |
| VS Code | Install **Live Server**, right-click `index.html` → *Open with Live Server* |
| Acode (Android) | Open the folder and use the built-in preview/server |
| Node.js | `npx serve .` inside this folder, then open the address it prints |
| Python | `python -m http.server 8000` inside this folder, then open http://localhost:8000 |

Start at `index.html`: it sends you to the dashboard if you're signed in, or to the login page if you're not.

### Demo mode (no backend yet)

`js/config.js` has `USE_MOCK: true`, so the site uses a **mock API** (`js/api/mock/`) and shows this banner on every page:

> **Demo mode:** data is stored in this browser only and is not saved to the server.

Demo sign-in: **any email and any password of 8 or more characters**. To see each error message, use one of these passwords:

| Password | Shows |
| --- | --- |
| `wrong-password` | "Email or password is incorrect." |
| `too-many` | "Too many attempts. Please wait a moment." |
| `server-error` | "Something went wrong on our side. Please try again." |
| `offline` | "Can't reach the server. Check your connection and try again." |

Mock login is **not security** — it only demonstrates the screen. Real protection comes from the backend.

**Demo quizzes.** The mock comes with 13 sample quizzes covering every state: drafts, published (open, scheduled, closing soon, no close date, closed), archived, a draft that participants already took (locked), an unfinished draft that fails the publish checks, an empty "Untitled quiz", and **"JCI Uniben General Knowledge"**, a draft with the client's 40 questions (see below). Changes you make are kept in this browser (`jci-mock:quizzes`) so you can try every action; **Settings → Demo data → Reset demo data** brings the originals back.

To see the quiz list's error state, search for one of these on the Quizzes page:

| Search for | Shows |
| --- | --- |
| `simulate:server-error` | "Something went wrong on our side. Please try again." with Try again |
| `simulate:offline` | "Can't reach the server. Check your connection and try again." with Try again |

Turning your device's Wi-Fi off works too: the offline banner appears and list requests fail with the network message.

In the quiz editor, typing `simulate:server-error` (or `simulate:offline`) into a field makes that save fail, so you can watch the editor retry and recover. Delete the text and it saves normally.

**Demo data.** Everything you change in demo mode stays in this browser only. **Settings → Demo data → Reset demo data** brings back the originals, and when an update changes the demo data your browser's copy is refreshed once by itself.

**Trying the tricky cases in the editor (demo mode):**
- *Changed somewhere else:* open the same quiz in two tabs, edit and save in one, then edit in the other. The second tab stops autosaving and offers to load the latest version.
- *Session expired:* while editing, sign out in another tab, then keep typing. A sign-in dialog appears and your change is saved after you sign in, with no redirect and nothing lost.

**Trying the question builder (demo mode):**
- Type `simulate:server-error` into a question's text to watch a question save fail and retry.
- Upload any JPG, PNG or WebP image. A file whose **name contains `simulate-error`** (e.g. `simulate-error.png`) fails part-way, so you can see the error, **Try again** and the publish blocker.
- Demo uploads are shrunk to fit 1000 px and kept in this browser (`jci-mock:assets`). With the real backend, the original file goes to the server and only its asset id and URL are kept.
- "Leadership Essentials" and "Community Impact Projects" have participant attempts, so their questions are **locked** (read-only); archived quizzes are read-only too.

**Trying appearance, settings and Preview (demo mode):**
- The demo quizzes have different looks: "Project Management 101" uses **Ocean** with Poppins (and question 4 has its own **Custom style**), "Leadership Essentials" uses **JCI Bold**, "Public Speaking Basics" uses **Paper** with Lora, and "Teamwork & Collaboration" uses **Night** with Nunito.
- "Leadership Essentials" is locked (participants have started), so its Settings tab only lets you move the close time later and change when results are shown.

**Trying duplication and the Question Bank (demo mode):**
- **Duplicate "Teamwork & Collaboration"**: its first question's image file is "gone" in the demo, so the copy opens with an *About this copy* note saying exactly what wasn't copied.
- The **Question Bank** has 13 demo questions (one archived), with tags. Some demo quizzes use them.
- In "Project Management 101", question 1 came from an **older bank version**: it says *newer version available*, and **Review update** shows both side by side. "JCI Mission & Creed" has the same, but it's locked, so you can only compare.
- The bank is kept in this browser as demo data (`jci-mock:bank`).

**Trying Results and grading (demo mode):**
- The demo has **150 made-up participants** (emails end in `@participants.demo.test`) and about 490 attempts across 8 quizzes, made the same way every time. Some paragraph answers are already graded; the newest ones wait for a grader. A couple of attempts on open quizzes are still **in progress**.
- Open **Results → 2025 Induction Quiz → Grade next** to grade the oldest waiting attempt. After saving, the total, the percentage and the status all come back from the (demo) server.
- Type `simulate:server-error` into the feedback box to watch a grade fail to save (what you typed stays). Search for `simulate:server-error` in the attempts list for its error state.
- The demo server grades like the backend should (section 15): it lives in `js/api/mock/mock-grading.js`, is labelled **DEMO MODE ONLY**, and is never used with the real backend. The admin site itself never grades.
- Attempts are kept in this browser as demo data (`jci-mock:attempts`).

**The client's 40 questions.** They're in the draft quiz **"JCI Uniben General Knowledge"**: 40 multiple-choice questions, 1 mark each, with the four options exactly as supplied. **No correct answers are ticked yet**, so the publish checks list each question until you tick its correct option in **Quizzes → JCI Uniben General Knowledge → Questions**. They're not in the Question Bank (bank questions have to be complete); once the answers are ticked, **Save to bank** adds any of them.

**Trying the Dashboard (demo mode):**
- The numbers count up once when the page opens (not with reduced motion). Each card opens the matching list.
- **Needs attention** shows the attempts waiting for grading (top 3 quizzes, linked straight to their waiting attempts), "Leadership Essentials" closing in 2 days and "Public Speaking Basics" opening in 6 days.
- Open `dashboard.html?simulate=server-error` (or `?simulate=offline`) to see the honest error message; the quick actions still work.
-

---

## Connecting the real backend

Everything that talks to the server is already written: `js/api/endpoints.js` calls the real API, `js/api/adapters.js` translates field names, and `js/api/client.js` handles errors, timeouts and sign-in. Connecting is mostly settings, then checking each screen against real data.

**1. Agree the basics with the backend developer** (decision 1)
- [ ] The API address (for example `https://api.jciuniben.org` or `/api` on the same site).
- [ ] Cookie sessions (recommended, already supported) or tokens. Tokens would need a small change in `js/api/client.js`; they should never be kept in localStorage.
- [ ] Admins sign in with an email or a username.
- [ ] Whether CSRF protection is used, and its cookie and header names.

**2. Change the settings** in `js/config.js`
- [ ] `USE_MOCK: false`
- [ ] `API_BASE_URL` = the API address
- [ ] `AUTH.identifier` = `'email'` or `'username'`
- [ ] `AUTH.csrfCookieName` / `AUTH.csrfHeaderName` if CSRF is used
- [ ] `UPLOAD.maxBytes` = the server's real image limit
- [ ] `DEBUG: false` (keep it off in production)

> **Important for cookie sessions:** host the admin site and the API on the **same site** — for example `admin.jciuniben.org` and `api.jciuniben.org`, or proxy `/api` through the admin site's host. Browsers (especially Safari and iOS) block login cookies sent between unrelated domains, which would make sign-in fail. If the API is on another subdomain, its CORS settings must allow credentials from the admin site (uploads included).

**3. If field names differ**, change **only** `js/api/adapters.js` (and the paths in `js/api/endpoints.js`). The adapters already accept camelCase and snake_case, and `participant`, `student` or `user`. `tests.html` has adapter checks: add the real responses there as examples.

**4. Check each screen against the real API** (the manual checklist under [Testing](#testing) covers each one)
- [ ] Sign in, sign out, an expired session (the sign-in dialog), 403 for a non-admin account.
- [ ] Quiz list: search, filters, sorting, pages; "All" shows drafts and published only (risk 7).
- [ ] Create, edit and autosave a quiz; two tabs editing the same quiz (409); offline and back.
- [ ] Questions: add, edit, reorder, delete and undo, images (upload progress and errors).
- [ ] Settings and locking after someone starts (422 `SETTINGS_LOCKED`, `QUESTIONS_LOCKED`).
- [ ] Publish, unpublish, archive, restore, delete (blocked when attempts exist), duplicate (what wasn't copied).
- [ ] Question Bank: versions, usage, Review update, Save to bank.
- [ ] Results, attempts and grading: totals come back from the server after each grade.
- [ ] Dashboard: every number matches the lists it links to.
- [ ] Run `tests.html` (its checks talk to the demo server directly, so they work whatever `USE_MOCK` says).

**5. Before going live**
- [ ] Replace `assets/logo.svg` with the authorised JCI Uniben logo.
- [ ] Make sure `USE_MOCK` is `false` on the live site: the demo banner and the demo sign-in hint then disappear by themselves.
- [ ] Re-run the accessibility and screen-size checks below on the live site.

---

## Deploying

Upload the whole folder to any static host (Netlify, Vercel, GitHub Pages, cPanel). `404.html` is used automatically by most hosts.
The pages tell search engines not to index them (`noindex`).

---

## Handoff: backend developer

The admin site needs **31 endpoints**. Each stage's details (fields, errors, rules) are below the table; `js/types.js` has every data shape and `js/api/endpoints.js` every call.

**Conventions for every endpoint**
- JSON in and out. Errors as `{ "error": { "code", "message", "fieldErrors" } }` with the right HTTP status: 401 not signed in, 403 not an admin, 404 not found, 409 changed somewhere else, 422 rule or validation problem (with `fieldErrors`), 429 too many attempts, 5xx server trouble.
- Lists return `{ "items": [...], "page", "pageSize", "total" }`. Filtering, sorting and paging happen on the server.
- Times are ISO 8601 in UTC. The site shows them in the admin's time zone.
- Quizzes and bank questions carry a `version`; saves send it back and get **409** when it's stale. Repeating a request that already worked should succeed (safe retries).
- **Admin-only fields** (`isCorrect`, `acceptedAnswers`, `caseSensitive`, `gradingNotes`) must never be sent to participants before results allow it.
- **Scores, totals and permissions are decided by the server.** The admin site only shows what comes back.

| Area | Endpoint | Used by |
| --- | --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` | login, sign out, the session check on every page |
| Dashboard | `GET /admin/dashboard/summary` | Dashboard |
| Quizzes | `GET /admin/quizzes?q=&status=&availability=&sort=&page=&pageSize=&hasAttempts=` | Quizzes, Results overview |
| | `POST /admin/quizzes`, `GET` / `PATCH` / `DELETE /admin/quizzes/{id}` | New quiz, the editor, Delete |
| | `POST /admin/quizzes/{id}/publish`, `/unpublish`, `/archive`, `/restore`, `/duplicate` | quiz actions |
| Questions | `POST /admin/quizzes/{id}/questions`, `PATCH` / `DELETE …/questions/{questionId}`, `PUT …/questions/order` | question builder |
| Uploads | `POST /admin/uploads/images` (multipart, field `file`) → `{ assetId, url }` | images |
| Question Bank | `GET` / `POST /admin/bank-questions`, `GET` / `PATCH` / `DELETE /admin/bank-questions/{id}`, `POST …/{id}/archive`, `POST …/{id}/restore`, `GET /admin/bank-questions/tags` | Question Bank |
| Results | `GET /admin/quizzes/{id}/attempts?…`, `GET /admin/quizzes/{id}/results/summary` | Results |
| | `GET /admin/attempts/{id}`, `PATCH /admin/attempts/{id}/answers/{questionId}/grade` | attempt page, grading |

The brief's `POST …/questions/from-bank` isn't needed (decision 17).

### Details by stage

#### Stage 1

- `POST /auth/login` with `{ "email", "password" }` (or `username`) → sets the session cookie and returns the admin (`{ id, name, email, role }`, optionally wrapped in `{ "admin": … }`).
- `POST /auth/logout` → ends the session.
- `GET /auth/me` → the signed-in admin, or **401** if not signed in, **403** if the account isn't an admin.
- Errors in the agreed format: `{ "error": { "code", "message", "fieldErrors" } }`, and **429** for too many login attempts.
- CORS with credentials allowed for the admin site's origin (if the API is on a different subdomain), and the CSRF cookie/header names if CSRF protection is used.

#### Stage 2

- `GET /admin/quizzes?q=&status=&availability=&sort=&page=&pageSize=` → `{ "items": [...], "page", "pageSize", "total" }`. Each item needs `id, title, description, status, availability, settings.opensAt, settings.closesAt, settings.maxAttempts, settings.durationMinutes, questionCount, totalMarks, attemptCount, createdAt, updatedAt`.
  - `sort` is `field:direction` with fields `updatedAt`, `title`, `createdAt`, `attemptCount`.
  - **No `status` means "draft and published"** (archived quizzes are hidden from active lists). Please confirm, or tell me the parameter for "all except archived".
  - `availability` is worked out by the server from its own clock, and only for published quizzes.
- `GET /admin/quizzes/{id}` → the full quiz (used by the temporary quiz pages now, the editor in Stage 3).
- `POST /admin/quizzes` with `{ "title" }` → the new draft (422 with `fieldErrors.title` if the title is invalid).
- `POST /admin/quizzes/{id}/publish`, `/unpublish`, `/archive`, `/restore`, `/duplicate` → the updated (or new) quiz.
- `DELETE /admin/quizzes/{id}` → 204; drafts with no attempts only.
- When a publish is refused, **422 with `code: "PUBLISH_BLOCKED"`** and one plain-language message per problem in `fieldErrors` (the list shows them all). Other refused actions: 422 with a plain message.
- The server must enforce the same rules as the menus (who can publish, delete, etc.) — the menus are only guidance.

#### Stage 3

- `PATCH /admin/quizzes/{id}` with `{ "version": 7, "title"?, "description"?, "instructions"? }` (only the fields that changed) → the updated quiz with its **new `version`**.
  - **409** when `version` doesn't match (someone else saved first). The editor then stops autosaving and offers to reload. Please never apply a stale update.
  - **422** with `fieldErrors` for invalid fields (title required, up to 120 characters; description up to 500; instructions up to 2,000).
  - **422 with `code: "READ_ONLY"`** for archived quizzes.
  - **401** when the session has expired. The editor asks the admin to sign in again and retries the same request, so it must be safe to repeat.
- Every action that changes a quiz (publish, unpublish, archive, restore) must also return the quiz with its new `version`, so later saves don't see a false conflict.
- Instructions are plain text with line breaks. The participant section should show them as text (no HTML), keeping the line breaks.

#### Stage 4

Every call below sends the quiz `version` being edited and returns the **whole updated quiz with its new `version`** (the same shape as `GET /admin/quizzes/{id}`).

- `POST /admin/quizzes/{id}/questions` with `{ "version", "position", "question": {...} }` — add a question at `position` (1 = first). The question carries its **own id** (a UUID made by the admin site), and so does each option.
- `PATCH /admin/quizzes/{id}/questions/{questionId}` with `{ "version", "question": {...} }` — the whole question is sent (simplest to apply and to retry).
- `DELETE /admin/quizzes/{id}/questions/{questionId}?version=7` — delete one question.
- `PUT /admin/quizzes/{id}/questions/order` with `{ "version", "questionIds": [...] }` — every question id, in the new order (409 if the list doesn't match the quiz's questions).
- `POST /admin/uploads/images` (multipart/form-data, field `file`) → `{ "assetId", "url" }`. JPG, PNG or WebP; please confirm the size limit (5 MB assumed, in `CONFIG.UPLOAD`). Answer **413** if too large and **422** for other file types.
- The question body (only the fields its type uses): `id, type, text, explanation, marks, image, appearance, source`, plus `options[{ id, text, image, isCorrect }]` for choice types, `acceptedAnswers, caseSensitive, maxLength` for short answer, and `gradingNotes, maxLength` for paragraph. Images are sent as `{ assetId, alt, decorative, placement?, size? }`; the server adds the `url` when it returns the quiz.
- **Errors:** 409 `VERSION_CONFLICT` for a stale version; 404 `QUESTION_NOT_FOUND` for a question deleted elsewhere; **422 `QUESTIONS_LOCKED`** once any participant has started the quiz; 422 `READ_ONLY` for archived quizzes; 422 `VALIDATION_ERROR` with `fieldErrors` for a malformed question (e.g. marks not above 0, too many options, an unknown asset).
- **Drafts may be unfinished** (no text yet, no correct answer). Please accept them when saving and check completeness only when publishing.
- **Retries must be safe:** after a timeout the admin site repeats the same request. Please treat a create whose id already exists with the same content, an update whose content is already stored, a delete of a question that's already gone, and an order that's already in place as **success** (return the quiz) rather than an error. The demo server does exactly this.
- `isCorrect`, `acceptedAnswers`, `caseSensitive` and `gradingNotes` are **admin-only**: the participant-facing API must never send them to participants before they submit.

#### Stages 5 and 6

- `PATCH /admin/quizzes/{id}` also accepts `settings` and `appearance`, each sent **whole** (the complete object from section 30), with the same `version` rules (409) as Stage 3.
  - `settings` adds one proposed field: `shortAnswerCaseSensitive` (decision 15). Times are ISO 8601 UTC; `durationMinutes` 1–600 or `null`; `maxAttempts` a whole number of at least 1 or `null` (unlimited).
  - `appearance` must be stored exactly as sent (font name, size in px, `#RRGGBB` colours, booleans, `left`/`center`) and returned the same way, so the participant site can render it.
  - Please answer **422 `SETTINGS_LOCKED`** when participants have started and a change goes beyond: a later `closesAt`, `resultVisibility`, `showCorrectAnswers` (section 19). Appearance stays editable.
- Publishing must also refuse: results "after the quiz closes" with no close time, and `maxAttempts` below 1 (the demo server does).
- Question `appearance` holds overrides only (`{}` = inherit). Please store it as sent.
- The participant-facing API must never send `isCorrect`, `acceptedAnswers`, `caseSensitive` or `gradingNotes` to participants before results allow it; the Preview overlay only exists in the admin site.

#### Stages 7 and 8

- **Duplicate:** `POST /admin/quizzes/{id}/duplicate` may return `{ "quiz": {...}, "notCopied": [{ "item": "Question 2’s image", "reason": "the image file is no longer stored, so add it again." }] }`. A plain quiz response still works (nothing listed). Please copy `source` links and image asset references.
- **Question Bank** (from section 30):
  - `GET /admin/bank-questions?q=&type=&tag=&usage=used|unused&status=active|archived&sort=&page=&pageSize=` → `{ items, page, pageSize, total }`. Sorts: `updatedAt:desc|asc`, `text:asc|desc`, `usage:desc`. No status = active only.
  - `GET /admin/bank-questions/{id}`, `POST /admin/bank-questions`, `PATCH /admin/bank-questions/{id}` with `{ ...question, "tags": [], "version": 3 }`, `DELETE /admin/bank-questions/{id}`, `POST …/{id}/archive`, `POST …/{id}/restore`, `GET /admin/bank-questions/tags` → `["Leadership", …]`.
  - Each bank question: the question fields (as for quizzes, without `order`/`source`), plus `tags`, `status`, `version`, **`usedInQuizCount`** (quizzes with a copy whose `source.bankQuestionId` is this id), `createdAt`, `updatedAt`.
  - **Versions:** a PATCH that changes the content makes `version + 1`; tags alone don't. 409 on a stale `version`; repeating an already-applied request returns success, as for quizzes.
  - **Delete:** 422 `IN_USE` when `usedInQuizCount > 0` (archive instead). Archived questions: 422 `READ_ONLY` on PATCH.
  - Question create/PATCH in quizzes must store `source` as sent (it's how "From Question Bank · v3" and "newer version" work).
- Quizzes must never change when a bank question is edited (they keep their copy), so attempts always match what participants saw.

The full proposed data model and endpoint list are in the project brief (section 30) and in `js/types.js`.

#### Stage 9

- `GET /admin/quizzes?hasAttempts=true&status=any&…` → the quiz list as before, plus **`pendingGradingCount`** on each quiz (attempts waiting for a grader). `status=any` includes archived quizzes.
- `GET /admin/quizzes/{id}/attempts?q=&status=&from=&to=&sort=&page=&pageSize=` → `{ items, page, pageSize, total }`.
  - `q` matches the participant's name or email; `status` is `in_progress | submitted | pending_grading | graded`; `from`/`to` are UTC ISO times (start and end of the admin's local days), compared with `submittedAt` (or `startedAt` while in progress).
  - Sorts: `submittedAt:desc|asc`, `score:desc|asc` (by percentage), `name:asc`.
  - Each item: `id, quizId, participant { id, name, email }, attemptNumber, status, startedAt, submittedAt, score, maxScore, isFinal` (the attempt that counts: highest or latest, per the quiz). `score` is null while in progress.
- `GET /admin/quizzes/{id}/results/summary` → `{ attempts, averagePercent, highestPercent, lowestPercent, pendingGrading }` over submitted attempts (null percentages when there are none).
- `GET /admin/attempts/{id}` → the attempt as above plus:
  - `quiz { id, title, status }`;
  - `answers: [{ questionId, selectedOptionIds, text, autoMarks, manualMarks, feedback, needsManualGrading }]`;
  - `questions`: the questions **as the participant saw them**, in the admin shape (with correct answers), so a later edit or bank update never changes old results;
  - `navigation { previousId, nextId, nextToGradeId }` — previous/next in the quiz's attempts (oldest submitted first), and the next attempt waiting for a grader.
- `PATCH /admin/attempts/{id}/answers/{questionId}/grade` with `{ "marks": 2.5, "feedback": "…" | null }` → the **updated attempt** (same shape as GET), with the new `score`, `status` and `isFinal` worked out by the server. Errors: 404 `ATTEMPT_NOT_FOUND` / `ANSWER_NOT_FOUND`, 422 `NOT_SUBMITTED` (in progress), 422 `AUTO_GRADED` (decision 6), 422 `VALIDATION_ERROR` with `fieldErrors.marks` (0 up to the question's marks) or `fieldErrors.feedback` (over 1,000 characters).
- Field names can be camelCase or snake_case, and `participant` can also be called `student` or `user`: the adapters accept all of them.
- Grading rules the demo follows (please confirm, section 15): multiple choice full marks or 0; checkboxes all-or-nothing by default, or partial (each right tick earns a share, each wrong tick takes one away, never below 0); short answers match ignoring extra spaces and, unless case-sensitive, capitals; paragraphs and short answers without accepted answers wait for a grader.

#### Stage 10

- `GET /admin/dashboard/summary` →
  ```json
  {
    "totals": { "quizzes": 11, "published": 6, "drafts": 5, "archived": 2, "attempts": 491 },
    "pendingGrading": { "attempts": 105, "quizzes": [{ "id": "…", "title": "…", "count": 25 }] },
    "closingSoon": [{ "id": "…", "title": "…", "closesAt": "ISO" }],
    "openingSoon": [{ "id": "…", "title": "…", "opensAt": "ISO" }],
    "recentQuizzes": [ /* about 5 quiz list items, most recently updated first */ ],
    "recentSubmissions": [{ "attemptId": "…", "quizId": "…", "quizTitle": "…", "participant": { "id", "name", "email" }, "submittedAt": "ISO", "status": "graded", "score": 7, "maxScore": 10 }]
  }
  ```
  - `quizzes` counts drafts + published (archived separately), so it matches the quiz list's "All". `attempts` is every participant attempt.
  - `pendingGrading.quizzes`: quizzes with attempts waiting for a grader, busiest first. `closingSoon`: open quizzes closing within 72 hours. `openingSoon`: scheduled quizzes opening within 7 days. Soonest first.
  - Any list the backend can't provide yet can be left out: the Dashboard says it isn't available rather than showing made-up numbers. snake_case works too.

The full proposed data model is in the project brief (section 30) and in `js/types.js`.

---

## Handoff: participant-section developer

The participant section (where people take quizzes) is built separately. For quizzes to look and behave the same there as in this site's Preview:

- **Reuse three files** (decision 14): `js/quiz/renderer.js`, `js/quiz/appearance.js` and `css/quiz-render.css`. They draw a quiz in its own colours and fonts and depend on nothing else in this site. Call `renderQuiz(quiz)` or `renderQuestion(question, quizAppearance)`; the admin-only "Correct" overlay only appears with `showCorrect: true`, so leave it off for participants.
- **Fonts:** load the same six Google Fonts (Inter, Poppins, Lora, Nunito, Merriweather, Roboto Slab — see `appearance.js`), or self-host them.
- **Text is plain text.** Quiz titles, instructions, questions, options and answers are never HTML. Show them as text and keep line breaks.
- **Admin-only fields** never reach participants before results allow it (see the backend notes).
- **Wording:** this site calls the people taking quizzes **participants** (anyone with an account, decision 12). Results show their **name and email** only (decision 11).
- **Still to agree** (see [Decisions](#decisions)): when participants see results (10, the admin picks per quiz) and one question per page or all on one page (13; Preview offers both).

---

## Decisions

Agreed decisions are marked **Agreed**; the rest use the default shown until agreed.

**With the backend developer**

| # | Decision | Default in the code |
| --- | --- | --- |
| 1 | How admin login works (cookie or token; email or username), the API base URL and endpoints | Cookie session, email, `/api`, endpoints below |
| 2 | Checkbox scoring | All-or-nothing |
| 3 | What can be edited after participants start | Section 19 rules |
| 4 | Which score counts with several attempts | Highest |
| 5 | Auto-submit when time runs out | Yes, enforced by the server |
| 6 | Admin override of auto-graded marks | Hidden (Results only grades paragraphs and short answers with no accepted answers). Easy to add if the backend supports it |
| 7 | CSV export: included? server or browser? | **Not built yet** (no button) until it's approved. If yes, browser-side from API data, or a server download |
| 8 | Admin roles | One admin role, full access |
| 9 | Password reset | Not shown |
| 15 | A quiz setting for default short-answer matching (section 20 asks for it, the data model doesn't have it) | `settings.shortAnswerCaseSensitive`, default `false` (ignore capitals); used for new short-answer questions |
| 16 | A question's own appearance once participants have started | Locked with the questions (the quiz-wide appearance can still change). Unlocking it would need the question endpoints to accept appearance-only changes on locked quizzes |
| 17 | How "Add from Question Bank" reaches the server | The quiz's normal question create (`POST …/questions`) with `source: { bankQuestionId, bankVersion }`, so adding, undo and conflicts work like any other question. The brief's `POST …/questions/from-bank` isn't needed; the server may check the snapshot against that bank version |
| 18 | After "Save to bank" | This quiz's question is linked to the new bank question (shows "From Question Bank · v1") |
| 19 | Bank questions with problems | Not saved until fixed (unlike quiz drafts), so reused questions are always complete |
| 20 | Versions | Content changes make a new version; changing only the tags doesn't |

**With the participant-section developer**

| # | Decision | Default |
| --- | --- | --- |
| 10 | When participants see results | Admin chooses per quiz; default "after the quiz closes" |
| 11 | Participant details shown in results | **Agreed:** name and email only |
| 12 | Who can take a quiz | **Agreed:** anyone with an account (called “participants”) |
| 13 | One question per page or all on one page | All on one page, with a toggle in Preview |
| 14 | Reusing `renderer.js` and `appearance.js` so quizzes look identical | Offer them both files |

---

## What each stage built

The newest first. Each part says which section of the brief it covers.

### What Stages 10 and 11 include

**Dashboard (Stage 10)** — section 11
- **Quick actions:** Create quiz (the same dialog as the quiz list), View all quizzes, Open results.
- **Summary cards:** Quizzes (drafts and published, with the archived count mentioned), Published, Drafts and Attempts. Each card opens the matching list.
- **Needs attention:** attempts waiting for grading (the busiest 3 quizzes, each linked to its waiting attempts), quizzes closing within 72 hours and quizzes opening within 7 days — or *Nothing needs your attention right now*.
- **Recently updated quizzes** (5) and **recent submissions** (5, with score and status).
- Every number comes from one request (`GET /admin/dashboard/summary`). Skeletons the same size as the content while loading; numbers count up once (600ms, not with reduced motion); an honest message when something fails or isn't provided — never made-up numbers.

**Stage 11 (everything that doesn't need the real backend)**
- **Accessibility pass:** an automated WCAG 2.1 A/AA check of every page and state, plus keyboard, focus, heading and reduced-motion checks (results under [Accessibility and screen sizes](#accessibility-and-screen-sizes)). It found and fixed:
  - the theme switch's unselected label picking up the *other* theme's colours (too faint: 2.5:1); tokens now apply to the page only;
  - option lists in the question editor losing their list meaning for screen readers;
  - a disabled pagination arrow with a label screen readers couldn't use.
- **Screen sizes:** every page at 320, 360, 768, 1024, 1440 and 1920px in both themes. Fixed the quiz Settings tab running off the side at 320px.
- **Motion:** grading progress now fills with a transform, as the brief asks, never by changing width.
- **Cleanup:** the temporary "coming in Stage N" page and its styles are gone; the New quiz dialog is shared by the quiz list and the Dashboard.
- **This README** now has the [connect-to-backend checklist](#connecting-the-real-backend), [one list of everything the backend needs](#handoff-backend-developer) and [the participant-section handoff](#handoff-participant-section-developer).

### What Stage 9 includes

**Results** (`results.html`) — section 24
- **Overview:** every quiz that has attempts, with its status, the number of attempts and how many are **waiting for grading** (or *All graded*). Search, sort (most attempts, recently updated, title) and pages, all kept in the URL.
- **One quiz** (`results.html?quiz=ID`):
  - a **summary strip** from the server: attempts, average, highest and lowest percentage, and how many wait for grading;
  - **Grade next (N waiting)** opens the oldest attempt that needs a grader; **Open quiz** goes to the editor;
  - the **attempts table**: participant (**name and email only**), attempt number (and **Counts** when several attempts are allowed and this is the one that counts), submitted (relative, with the exact time on hover), time taken, score, percentage and status (always an icon and words: *In progress*, *Submitted*, *Waiting for grading*, *Graded*). Rows waiting for grading have an amber edge;
  - **search** by name or email, **status** filter, **From/To dates** (whole days in your time zone), **sort** (submitted, score, name), pages, **Clear filters**, and Back/Forward — all in the URL, so a filtered list can be bookmarked or shared;
  - on phones and narrow windows each row becomes a small card with labels.
- **No CSV button**: export isn't approved yet (decision 7).

**One attempt** (`attempt.html?id=ID`)
- The participant's **name and email**, the attempt's status and the quiz's status, **Previous / Next** attempt, and **Next attempt to grade**.
- A **score card**: the total and percentage **from the server**, *Provisional* while answers wait for a grader and *Final* once everything is graded, and **grading progress** (“2 of 3 answers graded”).
- **Every question with their answer:** choices show what they picked, which option is correct (admin only) and whether they got it right — never colour alone, always the words *Their answer* and *Correct*. Short answers show the accepted answers (admin only); paragraphs show word and character counts and the grading notes (admin only). Their text is always shown as **plain text**, line breaks kept, never as HTML.
- **Manual grading** for paragraphs and short answers with no accepted answers: **Marks** (0 up to the question's marks, at most 2 decimals) and optional **Feedback** (up to 1,000 characters, with a counter), then **Save grade** (later **Update grade**). Mistakes are explained next to the box. After saving, the page shows the server's new total and status — the browser never adds anything up.
- Unsaved grades are kept: *Not saved yet* shows next to the button, leaving the page asks first, a failed save keeps what you typed, and if your session ends a sign-in dialog appears and the grade saves afterwards (no redirect, nothing lost).
- In-progress attempts show what's been saved so far, with no grading until they're submitted.
- Automatic marks can't be changed here (decision 6).

**Also in this stage**
- All wording now says **participant** instead of student (decisions 11 and 12), across the site, the code and this README.
- The client's 40 questions were added as a draft demo quiz (above).

### What Stages 7 and 8 include

**Duplication report (Stage 7)** — section 23
- Duplicating a quiz (from the list or the editor) still opens the new draft with *Duplicated. You're editing the copy.*, and now the editor shows **About this copy**:
  - anything the server **couldn't copy**, named exactly (e.g. *Not copied: Question 1's image. The image file is no longer stored, so add it again.*), instead of being dropped silently;
  - that the open and close times were cleared, and a reminder if results need a close time;
  - that participant attempts, results and the published status are never copied.
- **Got it** dismisses it. Questions, options, answers, marks, images, appearance, style overrides, settings and Question Bank links are all copied; editing the copy never changes the original (tested).

**The Question Bank (Stage 8)** — section 16
- **List (`question-bank.html`):** every bank question with its type, text, tags, marks, **Used in N quizzes**, **version** and last update. Search (text, options, answers and tags), filters for type, tag, used/unused and Active/Archived, five sorts and pages, all kept in the address. Click a tag to filter by it.
- **Row actions:** Edit, **Preview** (as participants see it, with correct answers), Archive (with Undo) / Restore, and Delete. Delete only works if no quiz has used the question; otherwise it explains why and offers Archive.
- **Editor (`question-edit.html`):** the **same question editor** as quizzes (all four types, options, images, marks, explanation, the question's own appearance), plus **Tags** (suggested from existing tags), **About this question** and a live **How it looks** preview.
  - An explicit **Save** button (not autosave). It shows *Unsaved changes*, warns before you leave, and Ctrl/Cmd+S saves. A question with problems isn't saved; the problems are shown.
  - The banner: *Changes apply to future uses. Quizzes that already use this question keep their own copy.* A content change saves as a **new version**. Changing only the tags doesn't.
  - Someone else saved first (409): nothing is overwritten, and you can keep editing or load the latest. An expired session opens the sign-in dialog and then saves.
  - Archive / Restore and Delete from the ⋯ menu; archived questions are read-only.

**The bank inside quizzes**
- **Add from Question Bank** (in the Add question menu, under the list, and on an empty quiz): a picker with search, type and tag filters, previews and checkboxes. **Add N questions** puts copies after the open question.
- Each copy is a **snapshot** linked to its source (bank question and version), shown as **From Question Bank · v3** on the card.
- **Newer version available:** when the bank has moved on, **Review update** shows this quiz's copy and the latest version side by side, with what changed (e.g. *Question text, Options*). **Update this quiz's copy** keeps the question's id and position. Locked quizzes can only compare, never update.
- **Save to bank** on any open question creates a new bank question (version 1) with optional tags, and links this quiz's question to it.
- Editing a bank question never changes existing quizzes, so old attempts always match what participants saw.

**Also in Stages 7 and 8**
- `tests.html` now runs **94 checks** (8 new: the copy report, bank snapshots and drafts, version differences, saving a bank link, tags, the bank's API shapes, and the demo server's versions, retries, usage counts, filters, archive and delete rules).

---

### What Stages 5 and 6 include

**Quiz appearance (Details tab)** — section 17
- **Six presets** that apply in one click and stay editable: JCI Classic, JCI Bold, Ocean, Night, Paper and High contrast (exact colours from the brief). The current one is marked; editing a colour unmarks it.
- **Font** (Inter, Poppins, Nunito, Lora, Merriweather, Roboto Slab, each loaded only when picked), **question text size** (14–28), **bold / italic / underline**, **alignment** (left or center), and three **colours**: question text, question card and quiz page.
- **Colour controls:** a swatch that opens the device's own colour picker, a hex field you can type into (`#abc` or `#aabbcc`; anything else is explained and the last good colour kept), and a fold-out of suggested and recently used colours you can move through with the arrow keys.
- **A live sample card** shows the quiz's first question exactly as participants will see it, and colours change smoothly as you edit.
- **Readability:** the contrast between text and card is checked as you change things ("Hard to read: contrast 2.1:1 (aim for 4.5:1)", or 3:1 for large text). **Suggest a readable color** offers the same hue, just darker or lighter enough. It never changes anything on its own.
- **Reset to default appearance** (with Undo).
- The note required by the brief: *These colors and fonts are what participants see. They are separate from your Dark Mode / Light Mode setting.* Switching Dark/Light Mode never touches a quiz's colours.

**Question appearance (Questions tab)**
- Every question card is now drawn **in the quiz's own look** (page colour, card, font, colours), the way participants see it, with correct answers marked for you.
- Each open question has an **Appearance** button: font, size, text colour, card colour, bold, italic, underline and alignment. Each row says **Quiz default** or **Custom**, with its own reset, plus **Reset all to quiz defaults** and its own live sample and contrast check.
- Only the properties you change are saved for the question (`{}` means "follow the quiz"), so changing the quiz's look updates every question that doesn't override it.
- Questions with their own style show **Custom style** on the card and in the outline.
- **Phones:** an **Outline** button opens the outline as a bottom sheet to jump between questions (section 13).

**Settings tab** — section 20
- **Timing:** a Time limit switch and minutes (1–600), with the note that the server submits automatically when time runs out.
- **Availability:** open and close times in your time zone, labelled (e.g. WAT, UTC+1), saved in UTC. Empty means "opens when published" / "stays open". Clear buttons.
- **Attempts:** maximum attempts or Unlimited, and which score counts (highest or latest) when there's more than one.
- **Grading:** checkbox scoring (all or nothing / partial credit) and the default short-answer matching (ignore capitals / capitals must match), which new short-answer questions start with.
- **Results:** when participants see them (straight after submitting / after the quiz closes / when you release them) and whether correct answers are shown.
- Problems are explained under the setting as you change it: close before open, close already passed, results "after closing" with no close time, attempts below 1, invalid minutes (blockers); a time limit longer than the open window (warning); an open time in the past (information).
- Instructions stay in Details; Settings links there instead of duplicating the field.

**Locking rules** — section 19
- Once any participant has started: questions are read-only (Stage 4), and in Settings only **a later close time**, **when results appear** and **showing correct answers** can change. A banner says so; other settings are visibly locked. Trying an earlier close time is explained and undone. The demo server enforces the same rules (422 `SETTINGS_LOCKED`).
- Appearance can still change, with a note that participants taking the quiz will see it straight away.
- Archived quizzes are fully read-only.

**Review & Publish (complete)** — section 21
- A summary: title, number of questions and their types, total marks, time limit, open and close times, attempts, results, correct answers and appearance.
- Blockers and warnings, each with **Fix** / **Review** that goes to the exact field: a setting, the quiz's text colour, a question's field, or a question's Appearance panel. New: settings blockers, and low-contrast **warnings** (once for the quiz, and for each question whose own style is hard to read).
- **Preview as participant**, and **Publish quiz…** (disabled until nothing blocks it, then a confirmation with the key facts).
- After publishing: a success box with the new status and **Back to quizzes**.

**Preview page (`quiz-preview.html`)** — section 22
- Shows the **saved** quiz exactly as participants will see it, in its own appearance. The editor saves any unsaved changes before opening it.
- The banner: *Preview: answers here are not saved or submitted.* You can click and type answers; **Submit** only says it's a preview.
- **Phone / Tablet / Desktop** widths (390, 768, 1100px), **All questions / One at a time** (with progress and Previous/Next), **Show correct answers** (admin-only overlay: correct options, accepted answers, grading notes, explanations) and **Clear answers**. The width and layout stay in the address, so refresh keeps them.

**For the participant-section developer: three shareable files**
- `js/quiz/appearance.js` — fonts, sizes, presets, **the inheritance rule** (`resolveAppearance`), the option size rule (`optionFontSize`: 85% of the question size, never below 14px) and the contrast maths.
- `js/quiz/renderer.js` — draws a question or a whole quiz from the API data; builds everything with `createElement` and `textContent`.
- `css/quiz-render.css` — the participant-facing styles, driven only by the quiz's appearance.
They have no other dependencies. Using them means a quiz looks the same in Preview and for participants (decision 14).

**Also in Stages 5 and 6**
- **Labels fixed:** labels built in JavaScript (since Stage 4) weren't properly linked to their fields because of a bug in the `el()` helper. That's fixed in one place, so screen readers now read every field's label.
- The question endpoint paths now follow the brief's proposed contract: `PATCH …/questions/{questionId}`, `PUT …/questions/order` and `POST /admin/uploads/images` (see "Needed from the backend developer for Stage 4").
- `css/questions.css` is now `css/editor.css` (the name in the brief's file structure), and the temporary `quiz-placeholder.js` is gone.
- `tests.html` now runs **86 checks** (18 new: presets, colour parsing, safe fallbacks, inheritance, option sizes, WCAG contrast, readable suggestions, the renderer's safety and admin-only overlay, one-at-a-time, every settings rule, the lock rules, UTC times, contrast and settings in publish checks, adapters, and the demo server's lock rules).

---

### What Stage 4 includes

**The question builder (Questions tab of `quiz-edit.html`)**
- **Cards in order.** One question is open for editing at a time; the others show a compact preview (text, type, marks, options with the correct ones ticked, accepted answers), so the list doubles as an overview. Click a card (or press Enter on its heading) to open it; **Done** or **Esc** closes it. A summary line shows *N questions · M marks in total · K graded by hand*.
- **Outline** (wide screens): a sticky list of every question with its number, type icon and first words. Click to jump; drag to reorder; a dot marks questions with something to fix.
- **Four question types**, each defined once in a registry (`js/quiz/question-types.js`) with its label, icon, defaults, validation, grading note, editor and preview:
  - **Multiple choice:** 2–10 options, exactly one correct answer (a radio-style marker that pops when chosen).
  - **Checkboxes:** 2–10 options, at least one correct; the grading note follows the quiz's checkbox scoring (all-or-nothing or partial).
  - **Short answer:** accepted answers as chips (Enter adds one, up to 20), a **Case sensitive** switch, and "Graded manually" when there are none. Extra spaces are always ignored.
  - **Paragraph:** always graded by hand, with optional grading notes that only graders see.
- **Options:** type, then **Enter** adds the next option; **Backspace** on an empty one removes it; **Alt + ↑/↓** or the drag handle moves it; the × button removes it with **Undo**. Each option can have its own image.
- **Marks:** more than 0, up to 2 decimal places (e.g. 1.5). A wrong value is explained as you type and the last good value comes back when you leave the field, so nothing invalid is ever saved.
- **More options:** an explanation shown with results (if correct answers are shown), and a maximum answer length for short answer and paragraph.
- **Changing the type** keeps the text, marks, image and explanation. If something would be lost (options, grading notes, a second correct answer…), a dialog lists exactly what, and you can keep the old type. Correct options become accepted answers and the other way round.
- **Add** from the **Add question** menu (inserted after the open question), from the quick buttons under the list, or from the four type cards on an empty quiz. **Duplicate** puts an open copy right after; **Delete** has **Undo** for 6 seconds.
- **Reordering:** drag a card by its handle (mouse, pen or touch; the page scrolls near the edges; Esc cancels), or use **Move up / Move down**, or **Alt + ↑/↓** on a question's heading. Cards glide into place.
- **Images:** add one to a question or an option by choosing a file or dragging it onto the open card. JPG, PNG or WebP up to 5 MB, checked before uploading. Uploads show a real progress bar with **Cancel**, failures offer **Try again** and **Choose another**, and then you set **alt text** (required unless marked **Decorative**), plus placement (above, below, beside) and size for question images. Only the backend's asset id and URL are kept — never a file path.
- **Messages at the right moment:** a brand-new question shows no errors while you fill it in. A field's message appears once you've used it, and every message appears once you close the question. Closed cards show "2 to fix". Messages are linked to their fields for screen readers.
- **Read-only when it must be:** if participants have started the quiz (locked) or it's archived, the builder shows previews only, with a note saying why — no editing, adding or dragging.

**Saving questions**
- Questions use the same autosave as the Details tab, with the same honest status. Each change goes to the server as one small call — **delete**, **add** (at its position), **edit**, then the **new order** — always with the quiz `version`. Several waiting changes (e.g. duplicate + move + edit) are sent one after another in a single save, without the status flickering.
- Fast edits collapse into one call, and a delete that's undone before it's saved never reaches the server. Undoing a delete that was already saved brings the question back as a new question (new id), so the server never sees an id it has thrown away.
- Question and option ids are created by the admin site (UUIDs), so a save retried after a timeout can't create a duplicate.
- **Conflicts:** if the quiz changed somewhere else (409), a question you're editing was deleted elsewhere (404), or participants started the quiz while you were editing (422 `QUESTIONS_LOCKED`), autosave stops and a banner explains what happened. **Copy my changes** now copies your questions too (as readable text), and **Load the latest version** refreshes the builder.
- If the server turns a question down (422), a message names the question and it opens.

**Review & Publish now**
- Lists every question problem in plain words ("Question 3 needs exactly one correct answer"), plus images still uploading or failed.
- **Fix** opens that question and puts the cursor in the exact field: the text, the marks, the empty option, the correct-answer marker or the image's alt text.

**Also in Stage 4**
- `js/api/client.js` gained `upload()` (XMLHttpRequest, because `fetch` can't report upload progress), still the only file that talks to the network.
- `tests.html` now runs **68 checks** (14 new: marks and length rules, the registry, every validation rule, type changes, copies, the save operations and their order, the question body sent to the server, publish checks with uploads, autosave across several changes, and the demo server's question endpoints including retries, 409, 404, locked and archived).
- Not here on purpose: **Appearance** for a question arrives in Stage 5, and **Save to Question Bank / Add from bank** in Stage 8. No placeholder buttons pretend otherwise.

---

### What Stage 3 includes

**The quiz editor (`quiz-edit.html`)**
- **Header:** breadcrumb (Quizzes / title), the title (updates as you type), status and availability badges, the number of attempts, the **save status**, **Preview**, the main action (**Publish…** for drafts, **Unpublish…** when published, **Restore** when archived) and a **⋯** menu (Duplicate, Archive…, Delete…).
- **Tabs:** Details, Questions (with a count), Settings, and Review & Publish (with a count of issues). They follow the ARIA tabs pattern: arrow keys, Home and End, and one indicator that glides between tabs. The current tab is in the address (`#details`, `#questions`, `#settings`, `#review`), so refresh and Back work.
- **Details tab:** title (required, up to 120 characters), description (up to 500) and instructions for participants (up to 2,000, line breaks kept), each with a live counter that turns amber near the limit and red over it. A side card shows questions, total marks, attempts, created and last saved. The appearance panel is marked for Stage 5, with the required note that quiz colours are separate from Dark Mode / Light Mode.
- **Autosave that tells the truth:**
  - It saves about 1.5 s after you stop typing, when you leave a field, when you switch tabs, before Preview or any action, and straight away with **Ctrl+S / ⌘S**.
  - Only one save runs at a time, and it sends only the changed fields plus the quiz `version`.
  - The status reads “Unsaved changes”, “Saving…”, then “All changes saved · just now” (with a check mark that draws itself). “Saved” is never shown before the server confirms.
  - **Failures:** changes stay on the page, it retries after 2, 4, 8, 16, then every 30 seconds, and there's a **Retry** button.
  - **Offline:** it waits and saves as soon as you're back online.
  - **Session expired (401):** a **sign-in dialog** opens (email filled in). After signing in, the pending change saves. It never redirects or loses work.
  - **Conflict (409):** autosave stops so nothing is overwritten. A banner offers **Load the latest version** (it asks first if you have unsaved changes) and **Copy my changes**.
  - **Validation:** errors appear under the field as you type, and Ctrl+S shows a summary with links. Invalid text is never sent.
  - Leaving the page with unsaved changes asks first.
- **Banners:** “Questions are locked” (participants have started; with Duplicate), “This quiz is live” (published, no attempts yet), and “This quiz is archived” (read-only; with Restore).
- **Questions tab:** a read-only outline (number, type, text, marks) — replaced by the question builder in Stage 4.
- **Settings tab:** the current settings, read-only, until Stage 6.
- **Review & Publish tab (early version):** a summary (question types, marks, timing, attempts, results), the publish checks split into **Fix before publishing** and **Worth a look**, each with a **Fix** button that goes to the right tab and field, and a **Publish quiz…** button that stays disabled until nothing blocks it. Stage 6 completes it.
- **Phones:** the save status, Preview and the main action sit in a bar at the bottom of the screen; the tabs scroll sideways.
- **Motion:** the tab indicator glides, panels fade up when you switch, the save status cross-fades between states, a failure icon shakes once, and banners slide in. All of it respects “reduce motion”.

**Also in Stage 3**
- The quiz actions (publish, unpublish, archive, restore, delete, duplicate) now live in one shared module (`js/quiz/quiz-actions.js`), so the list and the editor behave identically.
- **Duplicate now opens the copy** in the editor with “Duplicated. You’re editing the copy.” (section 23), from both the list and the editor.
- The quiz list shows messages carried over from other pages (e.g. “Deleted …” after deleting from the editor).
- The demo server now notices changes made in other tabs, so conflicts can be tried for real.
- `tests.html` now runs **54 checks** (12 new: autosave timing, queueing, invalid values, conflicts and retries; change detection; details validation; the PATCH body; every publish blocker and warning; the demo server's 409 and 422).

---

### What Stage 2 includes

**Quizzes page (`quizzes.html`)**
- **Search** by title and description, debounced (300 ms), with a spinner while it searches, a clear (×) button and a <kbd>/</kbd> shortcut. Outdated requests are cancelled, so a slow answer can never overwrite a newer one.
- **Filters**: status (All active, Draft, Published, Archived) and availability (Scheduled, Open, Closed — published quizzes only; it's disabled, with a screen-reader note, for drafts and archived quizzes). Archived quizzes are hidden from "All active".
- **Sorting** from a menu or by clicking the Title, Attempts and Last updated headers (`aria-sort` tells screen readers the order).
- **Pagination**: 10, 20 or 50 rows (the same preference as Settings), "Showing 21–40 of 134", page links that also work with a middle-click, and "Page 2 of 5" on phones.
- **Everything is in the URL** (`?q=bio&status=published&sort=title:asc&page=2`), so refresh, Back/Forward and shared links all work — even through the login page.
- **Active filters as chips** you can remove one by one, plus **Clear filters**.
- **Table on wide screens, cards on narrow ones.** The list adapts to its own width (CSS container queries): less important columns move into a line under the title on tablets.
- **Status badges** always show an icon and a word. Quizzes closing within 3 days are flagged "Closes in 2 days". A lock icon marks quizzes participants have already taken. Times show the time zone (e.g. "17:00 WAT").
- **Row actions (⋯)** — only the ones allowed for that quiz, with full keyboard support (arrow keys, Home/End, type-ahead, Esc):
  - *Edit / View*, *Preview*
  - *Duplicate* → a new draft "Copy of …" (or "Copy of … (2)") with no attempts and cleared dates; the copy is highlighted and a toast offers **Open copy**
  - *Publish…* → quick checks first (no questions, no marks), then a confirmation that repeats the key facts (questions, marks, opens, closes, attempts, time limit). If the server finds problems, they're listed with **Open quiz**.
  - *Unpublish…* → explains that attempts in progress can finish, and that locked quizzes stay locked
  - *Archive…* → explains it becomes hidden and read-only, results are kept, and it can be restored; toast offers **View archived**
  - *Restore* → back to Drafts
  - *Delete…* → drafts with no attempts only (Cancel is focused first). For a draft participants already took, the dialog explains why and offers **Archive instead**.
- **New quiz**: a dialog asks for a title (required, up to 120 characters, live counter), creates the draft and opens it.
- **Every state**: loading skeleton, quiet background refresh (a thin bar, rows dim slightly), three different empty states (nothing yet / nothing in this filter / no matches), an error state with Try again, 401 → sign in again and come back, 404 → "That quiz no longer exists".
- **Motion**: rows fade up on first load only; rows glide to new positions after sorting or changes; removed rows fade out and the gap closes; menus grow from their button; a changed row flashes softly and a newly published badge pops in; chips pop in. All of it turns off with "reduce motion".

**Also new**
- `quiz-edit.html` and `quiz-preview.html` — **temporary** read-only pages (real data from the API: summary, question outline, lock/archived notices) so links from the list already work. The real editor arrives in Stage 3 and Preview in Stage 6; both pages say so.
- **Settings → Demo data** (demo mode only): reset the sample quizzes.
- Quiz endpoints in `endpoints.js` and the mock, quiz adapters, shared quiz rules (`js/quiz/quiz-rules.js`), list URL state, a tiny store, date formatting, and reusable menu, badge, pagination and form-dialog components.
- `tests.html` now runs **42 checks** (17 new: URL state, pagination maths, quiz rules, availability wording, date wording, quiz adapters, demo data, sort options).

---

### What Stage 1 includes

- **Design tokens** for Dark Mode and Light Mode (`css/tokens.css`), plus base, layout, component, motion and page styles.
- **Theme switch** (sidebar, mobile drawer, login page, Settings page). The choice is saved as `jci-admin-theme`; a first visit follows the device setting. A tiny inline script in every page applies it before anything paints, so there's never a flash of the wrong theme (`js/theme-init.js` is the master copy — `tests.html` checks every page matches it).
- **Page shell**: sidebar (desktop), collapsible icon sidebar with tooltips (tablet), top bar + navigation drawer (phones), skip link, demo banner, offline banner, toasts, dialogs.
- **API layer**: `client.js` (the one fetch wrapper: base URL, cookies, JSON, timeouts, cancelling, friendly error messages), `endpoints.js` (real backend), `adapters.js` (field-name mapping), and the mock API with the same functions.
- **Login** with validation, error summary, show/hide password, Caps Lock warning, loading state, no double submits, clear error messages, and a safe "return to the page you wanted" link.
- **Session check** on every protected page (`GET /auth/me`) before any content is shown. Not signed in → login; no permission → `no-access.html`; server unreachable → an error with Retry.
- **Settings page** (complete): Dark Mode / Light Mode cards, rows per page, account details and Sign out.
- **404** and **no-access** pages.
- **Placeholder pages** for Dashboard, Question Bank and Results that honestly say which stage builds them (no fake features).
- **tests.html** with 25 automated checks.

---

## File structure

```
index.html  login.html  dashboard.html  quizzes.html  quiz-edit.html  quiz-preview.html
question-bank.html  question-edit.html  results.html  attempt.html  settings.html  no-access.html  404.html  tests.html  README.md
assets/   logo.svg (PLACEHOLDER — replace with the authorised logo)  favicon.svg
css/      tokens.css  base.css  layout.css  components.css  motion.css  pages.css
          editor.css (question builder, appearance and settings panels, Preview; editor pages only)
          quiz-render.css (how quizzes look to participants; shareable)
          results.css (Results and the attempt page; the Dashboard's styles are in pages.css)
js/
  config.js          settings (API URL, demo mode, page sizes, upload limits, auth)
  theme-init.js      master copy of the inline theme script
  types.js           JSDoc data shapes (Quiz, QuizSummary, Question, Option, Appearance, …)
  icons.js           inline SVG icons
  core/              dom, storage (preferences only), a11y, validate, motion, theme, session,
                     list-state (URL state), store, format (dates/numbers), flash (one-time messages),
                     autosave (save queue, retries, offline/session/conflict handling),
                     sortable (drag to reorder with Pointer Events)
  api/               client, endpoints, adapters, index (mock or real),
                     mock/ (mock-api, mock-data, mock-store, mock-grading — demo mode only)
  quiz/              quiz-rules (allowed actions, badges, availability wording, details validation),
                     quiz-actions (publish/unpublish/archive/restore/delete/duplicate flows),
                     publish-checks (blockers and warnings),
                     question-model (ids, copies, marks rules, save operations),
                     question-types (the type registry: validation, type changes, grading notes),
                     question-ui (each type's editor and preview), image-field (upload + alt text),
                     question-builder (the Questions tab),
                     appearance (presets, inheritance, contrast; shareable), renderer (shareable),
                     appearance-panel (quiz and question appearance), settings-rules, settings-panel,
                     bank-dialogs (add from bank, save to bank, review update),
                     results-rules (attempt statuses, time taken, percentages, grade checks)
  components/        shell, theme-switch, button, toast, dialog (incl. form dialog), states,
                     form-feedback, menu, badge, pagination, save-status, sign-in-dialog,
                     color-picker, font-select, tag-input
  pages/             index, login, dashboard, quizzes, quiz-edit, quiz-preview, question-bank,
                     question-edit, results, attempt, settings, no-access
  tests/             harness + test files used by tests.html
```

CSV export isn't built (decision 7), so there's no `csv.js`. Some planned files ended up under clearer names (e.g. `sortable.js` for `reorder.js`, `image-field.js` for `image-uploader.js`, `sign-in-dialog.js` for `session-dialog.js`).

---

## Build stages

| Stage | What | Status |
| --- | --- | --- |
| 1 | Foundation: tokens, shell, theme, API client, mock, login, session check, 404/no-access, README | **Done** |
| 2 | Quiz list: search, filters, sorting, pagination, URL state, action menus, New quiz, confirmations | **Done** |
| 3 | Quiz workspace: tabs, Details, save status, autosave, conflict and session handling | **Done** |
| 4 | Question builder: type registry, four types, options, correct answers, marks, images, undo, reordering | **Done** |
| 5 | Appearance: quiz-wide panel, per-question overrides, presets, color picker, contrast warnings, renderer.js | **Done** |
| 6 | Settings tab, Review & Publish, Preview page, locking rules | **Done** |
| 7 | Duplication, archive, restore and delete flows (already working from the list and the editor; Stage 7 adds the “what couldn’t be copied” report and polish) | **Done** |
| 8 | Question Bank: list, editor, versions, picker, Save to bank, Review update | **Done** |
| 9 | Results: results list, attempts, attempt page, manual grading (CSV waits for approval) | **Done** |
| 10 | Dashboard (built last so it uses real data) | **Done** |
| 11 | Accessibility and screen-size pass, cleanup, final README, connect-to-backend checklist | **Done** |
| 11b | Switch to the real API and check every screen against it | Waiting for the backend ([checklist](#connecting-the-real-backend)) |

---

## Testing

### Automated: `tests.html`

Open `tests.html` through the local server. It currently runs 107 checks, including the Dashboard (its adapter in both field styles, missing lists shown as unavailable, the demo numbers, count-up), Results (time taken, percentages, provisional/final, the grader's marks rules, URL state, the results adapters in both field styles, the demo server's grading rules and attempts endpoints), the copy report and the Question Bank (snapshots, versions, differences, tags, the demo server's bank rules), appearance (presets, inheritance, fallbacks, WCAG contrast, readable suggestions), the renderer (safe text, admin-only overlay, one at a time), every settings rule and the lock rules, the question model and type registry (marks rules, validation, type changes, copies), the save operations and their order, the question body sent to the server, autosave across several changes, the demo server's question endpoints, the autosave engine (timing, queueing, conflicts, retries), details validation, the publish checks and the demo server's conflict handling, plus validation rules, the API client's error handling (with a fake network), adapters (auth and quizzes), the safe return link after login, theme logic, that the mock and real API have the same functions, that text can never be inserted as HTML, that every page's inline theme script matches `js/theme-init.js`, list URL state, pagination maths, quiz rules (allowed actions, delete rules, publish blockers, availability wording), date wording, the demo data and the sort options.

### Manual acceptance checklist

Check these in demo mode now, and again against the real backend.

**Admin access (Stage 1)**
- [ ] Opening any page while signed out goes to login, and signing in returns you to that page.
- [ ] Empty or invalid fields show messages under each field and a summary with links at the top.
- [ ] Each demo error password shows the right message; the button shows a spinner and can't be double-submitted.
- [ ] Show/hide password works; a Caps Lock warning appears when Caps Lock is on.
- [ ] Opening the login page while signed in skips to the dashboard.
- [ ] Sign out (sidebar, drawer or Settings) returns to login; protected pages then redirect again.

**Themes and responsiveness (Stage 1 parts)**
- [ ] Dark Mode and Light Mode switch from the sidebar, the drawer, the login page and Settings, stay in sync, and persist after reload.
- [ ] No flash of the wrong theme when pages load.
- [ ] 360px: top bar + drawer (Esc and the backdrop close it, focus returns to the menu button). 768–1199px: icon sidebar with tooltips and an expand button. 1200px+: full sidebar.
- [ ] No sideways scrolling at 360, 768, 1024 and 1440px.
- [ ] Everything works with the keyboard only; the first Tab reaches "Skip to main content".
- [ ] With "reduce motion" turned on in the device settings, nothing slides or zooms.

**Quiz management (Stage 2)**
- [ ] Search finds quizzes by title or description; the spinner shows while it searches; × and Esc clear it; <kbd>/</kbd> jumps to it.
- [ ] Status and availability filters, sorting (menu and column headers) and page links all update the list **and the address bar**; refresh, Back/Forward and a copied link reproduce the same view.
- [ ] Chips show each active filter; removing one or pressing Clear filters works.
- [ ] Rows per page (list footer or Settings) is remembered on this device.
- [ ] The three empty states appear correctly: no quizzes yet, nothing in a filter (e.g. Archived after restoring everything), and no matches (search `zzz`). `simulate:server-error` shows an error with Try again.
- [ ] Draft, Published and Archived badges and Scheduled / Open / Closed availability display correctly, with icons; "Closes in …" appears for quizzes closing within 3 days.
- [ ] The ⋯ menu shows only allowed actions (draft / published / archived differ) and works with the keyboard.
- [ ] Publish: "Untitled quiz" is stopped before the dialog (no questions); "Effective Meetings" is refused by the server with a list of problems; "Project Management 101" publishes after a confirmation that repeats its key facts.
- [ ] Unpublish, Archive, Restore and Delete each explain the consequences first; "Community Impact Projects" can't be deleted (participants took it) and offers Archive instead.
- [ ] Duplicate creates "Copy of …" as a draft with 0 attempts; duplicating again gives "(2)".
- [ ] New quiz: an empty or too-long title shows a message; a valid title creates the draft and opens it.
- [ ] At 360px the list turns into cards, dialogs become bottom sheets, and nothing scrolls sideways.

**Quiz workspace (Stage 3)**
- [ ] Opening a quiz shows its title, badges, save status and four tabs. Refreshing or pressing Back keeps the right tab, and arrow keys move between tabs.
- [ ] Typing in the title updates the heading as you type; about 1.5 s after you stop, the status goes “Saving…” then “All changes saved · just now”. Refreshing shows the saved text.
- [ ] Leaving a field or pressing Ctrl+S / ⌘S saves straight away.
- [ ] Emptying the title shows an error under it and nothing is saved; Ctrl+S shows a summary with a link to the field.
- [ ] Going offline shows “Offline · saves when you reconnect”, and it saves as soon as you're back online.
- [ ] Typing `simulate:server-error` shows “Couldn’t save · Retry” and it retries on its own; deleting the text recovers.
- [ ] Two tabs on the same quiz: after the first saves, the second shows the “changed somewhere else” banner. Copy my changes works, and Load the latest version replaces the fields and turns autosave back on.
- [ ] Signing out in another tab while editing: the sign-in dialog appears, a wrong password is explained, and the right one saves your change. You stay on the page.
- [ ] Trying to leave with unsaved changes asks first.
- [ ] Locked, live and archived banners appear on the right quizzes; an archived quiz is read-only until restored.
- [ ] Review & Publish lists blockers and warnings, its Fix buttons go to the right place, and Publish stays disabled until nothing blocks it.
- [ ] Publish, Unpublish, Archive, Restore, Duplicate (opens the copy) and Delete (back to the list) all work from the editor.
- [ ] On a phone, the save status, Preview and the main action sit in the bottom bar and never cover the page.

**Question builder (Stage 4)**
- [ ] "Untitled quiz" shows four type cards; choosing one adds and opens the first question with the cursor in its text.
- [ ] Multiple choice: Enter adds an option, Backspace on an empty one removes it, Alt + ↑/↓ and the drag handle reorder, and only one option can be marked correct. Checkboxes allow several.
- [ ] Removing an option or deleting a question shows Undo, and Undo puts it back where it was.
- [ ] Short answer: Enter adds accepted answers as chips; the Case sensitive switch appears once there's one; with none it says "Graded manually".
- [ ] Paragraph: grading notes save; the maximum length (More options) refuses "abc".
- [ ] Marks: "2.555" is explained and the old value returns when you leave the field; "1.5" saves and the total updates.
- [ ] Changing a checkbox question to short answer lists what will be lost, and "Keep checkboxes" changes nothing.
- [ ] Duplicate, Move up / Move down, Alt + ↑/↓ on a heading, and dragging a card all reorder correctly; the order survives a refresh.
- [ ] Images: an image uploads with a progress bar; a GIF is refused before uploading; `simulate-error.png` fails with Try again; missing alt text blocks publishing until filled in or marked Decorative.
- [ ] A new question shows no errors until you leave a field or close it; then it shows "N to fix" and the outline marks it.
- [ ] Review & Publish → Fix opens the question and focuses the exact field (text, marks, empty option, correct answer, alt text).
- [ ] Two tabs on the same quiz: editing a question in both shows the "changed somewhere else" banner; Copy my changes includes the questions.
- [ ] Locked ("Leadership Essentials") and archived quizzes show questions read-only with a note explaining why.
- [ ] On a 360px phone: nothing scrolls sideways, handles and correct-answer markers are easy to tap, and the bottom bar never covers the last buttons.

**Appearance (Stage 5)**
- [ ] Details shows the appearance panel with the note about Dark/Light Mode; the live sample uses the quiz's colours and font.
- [ ] Each preset applies in one click and is marked; changing a colour afterwards unmarks it.
- [ ] Typing `#abc` in a colour field works; typing `blue` is explained and the last good colour comes back; the swatch row works with arrow keys and Enter.
- [ ] Light grey text on a white card shows "Hard to read: contrast …"; Suggest a readable color fixes it.
- [ ] Reset to default appearance goes to JCI Classic, and Undo brings your look back.
- [ ] Switching the admin site to Dark Mode or Light Mode never changes the quiz's colours.
- [ ] Question cards are drawn in the quiz's look; a question's Appearance panel shows Quiz default / Custom per row, with resets; the card and outline say Custom style.
- [ ] On a phone, the Outline button opens the outline as a bottom sheet.

**Settings, Review & Publish, Preview (Stage 6)**
- [ ] Times show your time zone; close before open, a past close time, and results after closing with no close time are explained and block publishing.
- [ ] Unlimited attempts, score rule, checkbox scoring, short-answer matching and results all save; new short-answer questions follow the matching rule.
- [ ] "Leadership Essentials": only the close time (later only) and results can change; an earlier close time is refused.
- [ ] Review & Publish: summary, Fix links to the exact place (settings, appearance, questions), Preview as participant, and Publish with a confirmation; afterwards a success box and Back to quizzes.
- [ ] Preview: banner, Phone/Tablet/Desktop, One at a time with progress, Show correct answers, Clear answers; refresh keeps width and layout; Submit sends nothing.

**Duplication (Stage 7)**
- [ ] Duplicating "Teamwork & Collaboration" opens the copy with *About this copy*, naming the image that couldn't be copied; Got it dismisses it.
- [ ] Editing the copy never changes the original; dates are cleared; attempts and results are not copied.

**Question Bank (Stage 8)**
- [ ] The bank lists questions with type, tags, marks, Used in N quizzes, version and last update; search, type, tag, used/unused, Active/Archived and sort all work and survive a refresh.
- [ ] Preview shows the question with correct answers; Archive has Undo; a used question can't be deleted (Archive is offered); an unused one can.
- [ ] New question: an incomplete one isn't saved; a complete one saves as version 1 with its tags; changing the text and saving makes version 2; changing only tags doesn't.
- [ ] Leaving with unsaved changes asks first; two tabs saving the same question don't overwrite each other.
- [ ] In a quiz: Add from Question Bank adds the chosen questions after the open one, marked "From Question Bank · vN"; the bank then counts them as used.
- [ ] "Project Management 101" question 1 says newer version available; Review update shows both versions and updates this quiz only. "JCI Mission & Creed" (locked) can only compare.
- [ ] Save to bank on a quiz question creates a bank question (with tags) and links the quiz question to it.
- [ ] Editing a bank question doesn't change any quiz's copy.

**Results (Stage 9)**
- [ ] Results lists only quizzes with attempts, with how many wait for grading; search and sort stay in the URL.
- [ ] A quiz's results show the summary strip, and the table shows name and email (no matric number), attempt, submitted, time taken, score, % and status with an icon and words.
- [ ] Search by name or email, status filter, From/To dates, sort, pages and Clear filters all work, survive a reload, and Back/Forward step through them.
- [ ] On a phone (360 px) the rows become cards with labels and nothing scrolls sideways.
- [ ] Grade next opens the oldest waiting attempt; Previous/Next and Next attempt to grade move between attempts.
- [ ] An attempt shows every answer, which option is correct and what they picked (in words, not colour alone), accepted answers and grading notes (admin only).
- [ ] Answers containing HTML (e.g. `<b>hi</b>`) appear exactly as typed, as text.
- [ ] Marks must be 0 up to the question's marks with at most 2 decimals; mistakes are explained next to the box.
- [ ] Save grade shows the server's new total and status; Provisional becomes Final when the last answer is graded; progress counts up.
- [ ] Leaving with an unsaved grade asks first; a failed save keeps the marks; an expired session asks you to sign in and then saves.
- [ ] In-progress attempts can't be graded.

**Dashboard (Stage 10)**
- [ ] The four numbers match the lists their cards open; numbers count up once (not with reduced motion).
- [ ] Needs attention links open the right quiz's waiting attempts, and quizzes closing or opening soon.
- [ ] Recent quizzes open in the editor; recent submissions open the attempt.
- [ ] Create quiz works from the Dashboard; the new draft is listed when you come back.
- [ ] With the server failing, the Dashboard says so (no numbers), offers Try again, and the quick actions still work.

**Accessibility and screen sizes (Stage 11)**
- [ ] Every page works with the keyboard alone, with a visible focus outline; the first Tab shows "Skip to main content".
- [ ] A screen reader (NVDA, VoiceOver or TalkBack) reads the headings, labels, statuses and announcements on each page.
- [ ] No sideways scrolling at 320, 360, 768, 1024, 1440 and 1920px, in both themes.
- [ ] With reduced motion turned on, nothing slides, counts up or shimmers.

**Integration (Stage 11b)**: follow the [connect-to-backend checklist](#connecting-the-real-backend).

Browsers to check: Chrome (desktop and Android), Firefox, Safari (iOS) and Edge. Page-change animations use View Transitions where supported (Chrome, Edge, recent Safari); other browsers simply load pages normally.

---

## Accessibility and screen sizes

What was checked in Stage 11, and how. The checking tools ran only on the developer's machine; nothing was added to the site.

| Check | How | Result |
| --- | --- | --- |
| WCAG 2.1 A and AA | axe-core on every page and state (Dashboard, quiz list, all five editor tabs, a locked quiz, Preview, Question Bank and its editor, Results, an attempt with grading, Settings, login, 404, no-access, the New quiz dialog and an open action menu), both themes, at 1360 and 360px | **0 problems** after the fixes listed in Stage 11 |
| Keyboard | Tab through every page: every stop has a visible focus outline, nothing is focused while invisible, focus never gets stuck; the skip link, dialogs (focus in, Esc, focus back) and the phone drawer | Pass |
| Headings | Exactly one `h1` per page and no skipped levels | Pass |
| Reduced motion | Every page with reduced motion on: no animation longer than 100ms keeps running | Pass |
| Screen sizes | Every page at 320, 360, 768, 1024, 1440 and 1920px, dark and light: no sideways scrolling, nothing sticking out | Pass (after fixing Settings at 320px) |
| Touch | Buttons, fields and menu items at least 44px tall on phones and tablets | Pass |

Not covered by automatic checks, so please try them by hand: a real screen reader, browser zoom at 200%, and Windows High Contrast mode.

---

## Token additions (please approve or change)

These aren't in the brief's token list but were needed to keep everything readable and meet WCAG AA. Each one is a single line in `css/tokens.css`.

| Token | Dark | Light | Why |
| --- | --- | --- | --- |
| `--input-border` | `#67638C` | `#80869A` | Form fields need an outline of at least **3:1** (WCAG 1.4.11). The brief's `--border-strong` is about 1.55:1, so it's kept for cards and dividers, and fields use this instead (3.5:1 dark, 3.6:1 light). |
| `--on-danger` | `#130F2D` | `#FFFFFF` | Text on red buttons (6.7:1 dark, 6.5:1 light). |
| `--success-soft`, `--warning-soft`, `--danger-soft` | 10–12% tints | 8–10% tints | Backgrounds for banners and alerts. Text on them is always `--text`; the status color is used only for icons and borders. |
| `--scrim`, `--skeleton`, `--skeleton-shine`, `--tooltip-*` | | | Dialog backdrops, loading skeletons, tooltips. |
| `--jci-blue`, `--jci-black`, `--jci-white`, `--jci-white-muted` | fixed | fixed | The login brand panel stays JCI Black in both themes. |
| `--z-menu` | `60` | `60` | Stage 2: keeps action menus above the page, below toasts. |

Stage 2 adds no new colors: badges, chips and highlights mix existing tokens (e.g. `color-mix(in srgb, var(--success) 40%, transparent)` for a badge border).

Stages 4–6 add no admin tokens either. `css/quiz-render.css` deliberately uses **no** admin tokens: everything comes from the quiz's own appearance (so Dark/Light Mode can't affect it), plus one fixed green (`#15803D`, 5:1 with white text) for the admin-only "Correct" overlay, and Preview draws a dark bezel around the phone and tablet frames.

Stages 9 and 10 add no tokens either (status colours reuse `--warning`, `--success` and `--primary` with their soft tints).

All other values match the brief exactly. Contrast was checked with the WCAG formula.

---

## Risks and things to settle early

1. **Cookies across domains** (see "Connecting the real backend"): put the admin site and API on the same site, or sign-in may fail on Safari/iOS.
2. **Autosave and conflicts:** every save (details and questions) is queued, one at a time, and carries the quiz `version`. This only protects against overwriting if the backend's question calls check the `version` too (see the Stage 4 backend details) — please make sure they do.
3. **Upload progress:** done with `XMLHttpRequest` inside `js/api/client.js` (still the only place that talks to the network). If the API is on another subdomain, its CORS settings must allow credentials for uploads as well.
4. **Time zones (Stage 6):** times are shown in the admin's device time zone with its label (e.g. WAT). If every admin is in Nigeria, showing everything in WAT regardless of device would avoid confusion when someone travels — say if you'd prefer that.
5. **Unpublished quizzes with attempts:** they return to Draft but stay locked (the lock follows attempts, not status). Worth confirming with the backend developer.
6. **Text formatting:** bold, italic and underline apply to a whole question (as specified), not to selected words. Word-level formatting would need a safe rich-text format agreed with the participant-section developer.
7. **"All active" in the quiz list (Stage 2):** the list asks for draft + published by leaving `status` out. If the backend treats "no status" as "everything including archived", archived quizzes would show up there — one line in `adapters.js` changes it.
8. **Demo data in localStorage:** in demo mode only, the mock keeps its sample quizzes in `jci-mock:quizzes` so you can try actions. The demo banner says data stays in the browser; with `USE_MOCK: false` nothing of the sort is stored.
9. **Safe retries (Stage 4):** if the backend doesn't treat repeated requests as success (see the Stage 4 backend details), a save that timed out but actually worked would show a false "changed somewhere else" banner. Nothing is lost (Load the latest version fixes it), but it would be confusing.
10. **Unused uploads:** an image that's uploaded and then replaced or removed stays on the server. The backend may want to clean up assets that no question uses after a while.
11. **Demo storage:** demo images are kept in this browser's storage, which holds about 5 MB. After many uploads the demo may stop keeping new ones after a reload (Reset demo data clears them). This doesn't apply to the real backend.
12. **Fonts:** quiz fonts come from Google Fonts (like Inter already does). The participant site must load the same six fonts, or quizzes fall back to similar system fonts. If Google Fonts is a concern, the font files can be self-hosted instead.
13. **Bank history:** Review update compares this quiz's copy with the bank's latest version (not a stored copy of each old version). That's enough to decide; if the backend keeps every version, the comparison could show the exact old version too.

---

## Security notes (frontend side)

- No secrets, keys or passwords in the code. Demo credentials are fake and only work in demo mode.
- All text from the API or from users is inserted with `textContent` — never as HTML.
- localStorage holds **preferences only** (`jci-admin-theme`, `jci-admin-rows`, `jci-admin-sidebar`, and `jci-admin-recent-colors` for the colour picker). In demo mode the mock also keeps its fake session (`jci-mock:session`), sample quizzes (`jci-mock:quizzes`), the demo Question Bank (`jci-mock:bank`), demo images (`jci-mock:assets`) and made-up attempts (`jci-mock:attempts`) there, plus a version number (`jci-mock:seed`) — clearly labelled demo data, never used with the real backend.
- sessionStorage holds at most one short UI message between pages (`jci-admin-flash`, e.g. "Draft created", or the few lines of *About this copy*), never quiz content.
- The "return to" link after login only accepts this site's own pages, so it can't be used to send admins to another website.
- The browser never decides scores or permissions — the backend does. Results only shows the totals the server returns; the demo grading in `mock-grading.js` is labelled DEMO MODE ONLY.
- Participants' answers and feedback are never written to the console or kept in the browser (outside demo mode).
- Correct answers, accepted answers and grading notes exist only in the admin site and the admin API. They're never written to the console or stored in the browser (outside demo mode).
- Uploaded images are referenced by the backend's asset id and URL only; local file paths are never sent or kept.
- Appearance values are validated before use (known fonts and sizes, `#RRGGBB` colours only), so a bad value from the API can't inject styles; quiz fonts load only from a fixed list.
