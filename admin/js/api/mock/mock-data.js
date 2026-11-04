// @ts-check
/**
 * CLEARLY FAKE DEMO DATA — used only when CONFIG.USE_MOCK is true.
 * Nothing here is a real person, account or quiz. Data is returned in the
 * backend's proposed JSON shape so it goes through adapters.js like real data.
 * Quiz, bank and attempt demo data is added in the stages that use it.
 */

/** The demo administrator returned by the mock /auth/me (API shape). */
export const DEMO_ADMIN = Object.freeze({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Demo Admin',
  email: 'admin@demo.jciuniben.test',
  role: 'admin'
});

/**
 * Demo-only passwords that trigger each login error, so every error state can
 * be tested without a backend. Any other password of 8+ characters signs in.
 */
export const DEMO_ERROR_PASSWORDS = Object.freeze({
  wrongCredentials: 'wrong-password',
  tooManyAttempts: 'too-many',
  serverError: 'server-error',
  networkFailure: 'offline'
});

/**
 * Demo-only searches that make the quiz list fail, so its error state can be
 * tested: search for one of these on the Quizzes page.
 */
export const DEMO_LIST_ERRORS = Object.freeze({
  serverError: 'simulate:server-error',
  networkFailure: 'simulate:offline'
});

// Demo images (Stage 7) --------------------------------------------------------
// Simple drawings as SVG data URLs, so the demo needs no image hosting.

/** @param {string} svg */
const svgUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** Images the demo server "stores" (asset id -> URL). */
export const DEMO_ASSETS = Object.freeze({
  'asset-demo-jci-badge': svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" rx="18" fill="#0097D7"/><circle cx="160" cy="90" r="58" fill="#130F2D"/><text x="160" y="106" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#FFFFFF">JCI</text></svg>')
});

/**
 * Shown in the original quiz, but its file is NOT in the demo store — so
 * duplicating "Teamwork & Collaboration" shows the "not copied" report.
 */
const RETIRED_ASSET_URL = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" rx="18" fill="#17152A"/><g fill="none" stroke="#0097D7" stroke-width="6"><circle cx="70" cy="90" r="26"/><circle cx="130" cy="90" r="26"/><circle cx="190" cy="90" r="26"/><circle cx="250" cy="90" r="26"/></g><path d="M96 90h8M156 90h8M216 90h8" stroke="#F5F6FA" stroke-width="6"/></svg>');

// Quizzes (Stage 2) ------------------------------------------------------------
// Thirteen demo quizzes covering every status, availability and lock state,
// plus the client's own 40 questions (draft, answers not marked yet).
// Dates are relative to the moment the demo data is first created, so
// "closes in 2 days" and "opens next week" stay true when you try it.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** @param {string} prefix @param {number} n */
const id = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Bank question ids. @param {number} n */
const bankId = (n) => id('40000000', n);

/**
 * Question builders (API shape). Option ids are derived from the question id.
 * @typedef {{ type: string, text: string, marks: number, options?: string[], correct?: number[], accepted?: string[], notes?: string, look?: Record<string, unknown>, image?: { assetId: string, alt: string }, source?: { bankQuestionId: string, bankVersion: number } }} QuestionSpec
 */
/** @param {string} text @param {number} marks @param {string[]} options @param {number | null} correct @returns {QuestionSpec} */
const mc = (text, marks, options, correct) => ({ type: 'multiple_choice', text, marks, options, correct: correct === null ? [] : [correct] });
/** @param {string} text @param {number} marks @param {string[]} options @param {number[]} correct @returns {QuestionSpec} */
const cb = (text, marks, options, correct) => ({ type: 'checkboxes', text, marks, options, correct });
/** @param {string} text @param {number} marks @param {string[]} accepted @returns {QuestionSpec} */
const sa = (text, marks, accepted) => ({ type: 'short_answer', text, marks, accepted });
/** @param {string} text @param {number} marks @param {string} [notes] @returns {QuestionSpec} */
const pa = (text, marks, notes = '') => ({ type: 'paragraph', text, marks, notes });

/**
 * @typedef {Object} QuizSpec
 * @property {string} title
 * @property {string} description
 * @property {'draft' | 'published' | 'archived'} status
 * @property {number} attempts
 * @property {number} created     days ago
 * @property {number} updated     days ago (fractions allowed)
 * @property {number | null} [opens]   days from now
 * @property {number | null} [closes]  days from now
 * @property {number | null} [duration]
 * @property {number | null} [maxAttempts]
 * @property {'immediately' | 'after_close' | 'manual'} [results]
 * @property {string} [preset]                        appearance preset id (default JCI Classic)
 * @property {Record<string, unknown>} [look]         other appearance changes
 * @property {QuestionSpec[]} questions
 */

/** @type {QuizSpec[]} */
const QUIZ_SPECS = [
  {
    title: 'JCI Mission & Creed',
    description: 'The JCI Mission, Vision and Creed — what every member should know.',
    status: 'published', attempts: 48, created: 21, updated: 10, opens: -10, closes: 14, duration: 20, maxAttempts: 1,
    questions: [
      { ...mc('What does JCI stand for?', 2, ['Junior Chamber International', 'Joint Council of Innovators', 'Junior Citizens Initiative', 'Journal of Community Impact'], 0), image: { assetId: 'asset-demo-jci-badge', alt: 'A blue badge with the letters JCI' }, source: { bankQuestionId: bankId(1), bankVersion: 1 } },
      mc('Complete the JCI Mission: “To provide development opportunities that empower young people to create …”', 2, ['positive change', 'global wealth', 'new businesses', 'better schools'], 0),
      cb('Which of these lines appear in the JCI Creed?', 3, ['That faith in God gives meaning and purpose to human life', 'That the brotherhood of man transcends the sovereignty of nations', 'That profit is the highest goal of enterprise', 'That service to humanity is the best work of life'], [0, 1, 3]),
      { ...sa('In what year did the JCI movement begin?', 2, ['1915']), source: { bankQuestionId: bankId(2), bankVersion: 1 } },
      mc('In which city did the JCI movement begin?', 2, ['St. Louis, USA', 'London, UK', 'Lagos, Nigeria', 'Geneva, Switzerland'], 0),
      pa('In your own words, explain what “active citizenship” means to you as a JCI member.', 5, 'Look for a clear definition and at least one practical example.')
    ]
  },
  {
    title: 'New Member Orientation',
    description: 'Getting started with JCI Uniben: membership, areas of opportunity and chapter basics.',
    status: 'published', attempts: 112, created: 45, updated: 12, opens: -30, closes: 30, duration: 30, maxAttempts: 2,
    questions: [
      mc('What is the age range for active JCI membership?', 2, ['18 to 40', '16 to 30', '21 to 45', 'Any age'], 0),
      mc('What is the JCI Vision?', 2, ['To be the leading global network of young active citizens', 'To be the largest participant union in Africa', 'To fund every community project worldwide', 'To train every member as an entrepreneur'], 0),
      cb('Which are the four JCI Areas of Opportunity?', 4, ['Individual', 'Community', 'Business', 'International', 'Political'], [0, 1, 2, 3]),
      sa('What is the short name of the JCI chapter at the University of Benin?', 2, ['JCI Uniben', 'JCI University of Benin']),
      mc('Which document sets out the rules your local chapter follows?', 1, ['The chapter constitution', 'The quiz guidelines', 'The campus timetable', 'The membership card'], 0),
      pa('Why did you join JCI, and what do you hope to gain in your first year?', 5)
    ]
  },
  {
    title: 'Leadership Essentials',
    description: 'Leadership styles, listening, goal setting and feedback.',
    status: 'published', attempts: 27, created: 14, updated: 6, opens: -5, closes: 2, duration: 25, maxAttempts: 1, preset: 'jci-bold',
    questions: [
      mc('Which leadership style involves the team in making decisions?', 2, ['Democratic', 'Autocratic', 'Laissez-faire', 'Transactional'], 0),
      cb('Which of these are signs of active listening?', 3, ['Summarising what the speaker said', 'Asking clarifying questions', 'Checking your phone while they speak', 'Interrupting to share your view'], [0, 1]),
      mc('What does the “S” in SMART goals stand for?', 1, ['Specific', 'Simple', 'Shared', 'Strategic'], 0),
      sa('Name the feedback model that describes the Situation, the Behaviour and its Impact.', 2, ['SBI', 'Situation-Behaviour-Impact', 'Situation Behaviour Impact']),
      pa('Describe a time you led a group through a disagreement. What did you learn?', 6)
    ]
  },
  {
    title: 'Public Speaking Basics',
    description: 'Confidence, structure and delivery for your first speeches.',
    status: 'published', attempts: 0, created: 9, updated: 1, opens: 6, closes: 21, duration: 15, maxAttempts: 1, preset: 'paper', look: { fontFamily: 'Lora', fontSize: 20 },
    questions: [
      mc('What is the best way to reduce nerves before a speech?', 2, ['Practise out loud several times', 'Memorise every word and never look up', 'Avoid thinking about it until you speak', 'Speak as fast as possible'], 0),
      cb('Which of these help hold an audience’s attention?', 3, ['Eye contact', 'Varying your pace and tone', 'Reading slides word for word', 'A clear story or example'], [0, 1, 3]),
      mc('Roughly how many main points should a five-minute speech have?', 1, ['Two or three', 'Ten', 'One sentence', 'As many as possible'], 0),
      pa('Write a 30-second opening for a speech about why young people should volunteer.', 5)
    ]
  },
  {
    title: 'UN Sustainable Development Goals',
    description: 'The 17 Global Goals and how local projects can support them.',
    status: 'published', attempts: 86, created: 60, updated: 40, opens: -40, closes: -3, duration: 30, maxAttempts: 1,
    questions: [
      mc('How many Sustainable Development Goals are there?', 2, ['17', '10', '12', '21'], 0),
      mc('By which year are the SDGs meant to be achieved?', 2, ['2030', '2025', '2040', '2050'], 0),
      mc('Which SDG is about quality education?', 2, ['Goal 4', 'Goal 1', 'Goal 7', 'Goal 13'], 0),
      cb('Which of these are Sustainable Development Goals?', 3, ['Zero Hunger', 'Climate Action', 'Clean Water and Sanitation', 'Fastest Internet'], [0, 1, 2]),
      sa('What is the name of SDG 13?', 2, ['Climate Action']),
      pa('Choose one SDG and propose a small project our chapter could run in Benin City to support it.', 6)
    ]
  },
  {
    title: 'Project Management 101',
    description: 'Planning, budgeting and running chapter projects.',
    status: 'draft', attempts: 0, created: 3, updated: 2 / 24, duration: 20, maxAttempts: 1, results: 'immediately',
    preset: 'ocean', look: { fontFamily: 'Poppins' },
    questions: [
      { ...mc('What is the first phase of a typical project life cycle?', 2, ['Initiation', 'Closing', 'Execution', 'Monitoring'], 0), source: { bankQuestionId: bankId(3), bankVersion: 1 } },
      { ...cb('Which of these belong in a project plan?', 3, ['Goals', 'Timeline', 'Budget', 'Members’ passwords'], [0, 1, 2]), source: { bankQuestionId: bankId(4), bankVersion: 1 } },
      sa('What does the abbreviation “KPI” stand for?', 2, ['Key Performance Indicator', 'Key Performance Indicators']),
      { ...pa('List the main risks of a community clean-up project and how you would reduce each one.', 5), look: { cardBackground: '#FFF7E6', bold: true } }
    ]
  },
  {
    // Deliberately unfinished: publishing it shows the server's "not ready" checks.
    title: 'Effective Meetings',
    description: 'Running short, focused meetings with clear outcomes.',
    status: 'draft', attempts: 0, created: 6, updated: 1, duration: null, maxAttempts: 1,
    questions: [
      mc('What should every meeting have before it starts?', 2, ['A clear agenda', 'A long guest list', 'Refreshments', 'A projector'], null),
      mc('Who usually records the minutes of a meeting?', 1, ['The secretary', 'The newest member', 'The guest speaker', 'Nobody'], 0),
      pa('', 3)
    ]
  },
  {
    // Was published, then unpublished after participants took it: still locked.
    title: 'Community Impact Projects',
    description: 'Planning projects that create lasting positive change.',
    status: 'draft', attempts: 15, created: 35, updated: 4, opens: -25, closes: -10, duration: 30, maxAttempts: 1,
    questions: [
      mc('What is the first step in planning a community project?', 2, ['Assess the community’s needs', 'Buy the materials', 'Announce the date', 'Print T-shirts'], 0),
      cb('Which of these help a project last after the chapter steps back?', 3, ['Training local volunteers', 'Partnering with local groups', 'Doing everything ourselves', 'Planning maintenance'], [0, 1, 3]),
      mc('Which JCI framework guides members through planning community projects step by step?', 2, ['The Active Citizen Framework', 'The Ten Year Plan', 'The Global Goals Index', 'The Impact Ladder'], 0),
      sa('What word describes measuring a project’s results against its goals?', 2, ['Evaluation', 'Impact assessment']),
      pa('Describe one community project you would like to lead and how you would measure its impact.', 6)
    ]
  },
  {
    title: 'Teamwork & Collaboration',
    description: 'How strong teams form, build trust and share work.',
    status: 'published', attempts: 9, created: 20, updated: 15, opens: -15, closes: null, duration: null, maxAttempts: null, preset: 'night', look: { fontFamily: 'Nunito' },
    questions: [
      { ...mc('Which stage of team development comes after “Forming”?', 2, ['Storming', 'Norming', 'Performing', 'Adjourning'], 0), image: { assetId: 'asset-demo-retired', alt: 'Four connected circles, one for each stage of team development' }, source: { bankQuestionId: bankId(5), bankVersion: 1 } },
      cb('Which behaviours build trust in a team?', 3, ['Keeping commitments', 'Sharing credit', 'Hiding mistakes', 'Giving honest feedback'], [0, 1, 3]),
      mc('What is the main benefit of giving everyone a clear role?', 2, ['Everyone knows who is responsible for what', 'Meetings become longer', 'Fewer people need to attend', 'It removes the need for a leader'], 0),
      pa('How would you help a quiet team member contribute more?', 4)
    ]
  },
  {
    title: 'Uniben Chapter History',
    description: 'Where the chapter fits in JCI Nigeria and the wider JCI movement.',
    status: 'archived', attempts: 64, created: 150, updated: 80, opens: -120, closes: -90, duration: 20, maxAttempts: 1,
    questions: [
      mc('Which university is home to the JCI Uniben chapter?', 2, ['University of Benin', 'University of Lagos', 'University of Ibadan', 'University of Nigeria'], 0),
      mc('In which city is the University of Benin?', 2, ['Benin City', 'Abuja', 'Port Harcourt', 'Enugu'], 0),
      sa('Which country’s national JCI organisation is the chapter part of?', 2, ['Nigeria', 'JCI Nigeria']),
      cb('Which of these are good ways to preserve a chapter’s history?', 3, ['Keeping meeting minutes', 'Archiving project photos', 'Deleting old records', 'Writing a yearly report'], [0, 1, 3]),
      pa('Which past chapter project would you most like to repeat, and why?', 5)
    ]
  },
  {
    title: '2025 Induction Quiz',
    description: 'End-of-induction check for the 2025 intake.',
    status: 'archived', attempts: 130, created: 330, updated: 300, opens: -320, closes: -310, duration: 30, maxAttempts: 1,
    questions: [
      mc('What is the JCI Creed?', 2, ['A statement of the beliefs JCI members share', 'The chapter’s bank account', 'A training certificate', 'A meeting schedule'], 0),
      mc('Which color is used in the JCI logo?', 1, ['Blue', 'Green', 'Red', 'Orange'], 0),
      cb('Which of these are responsibilities of a JCI member?', 3, ['Attending meetings', 'Taking part in projects', 'Paying dues on time', 'Speaking for JCI in the press without approval'], [0, 1, 2]),
      sa('Complete the JCI Vision: “To be the leading global network of young …”', 2, ['active citizens']),
      pa('What does being inducted into JCI mean to you?', 4)
    ]
  },
  {
    title: 'Untitled quiz',
    description: '',
    status: 'draft', attempts: 0, created: 0.5 / 24, updated: 0.5 / 24, duration: null, maxAttempts: 1,
    questions: []
  },
  {
    // The client's 40 questions, exactly as supplied. No correct answers are
    // marked yet (no answer key was given): mark them in the editor, and
    // Review & Publish lists every question that still needs one.
    title: 'JCI Uniben General Knowledge',
    description: 'JCI history, the Creed, the Areas of Opportunity, meetings and leadership.',
    status: 'draft', attempts: 0, created: 0.1, updated: 0.05, duration: 30, maxAttempts: 1, results: 'immediately',
    questions: [
      mc("JCI was founded by:", 1, ["Henry Giesenberg Jr.", "Henry Giessenbier Jr.", "Henry Giessenberg Sr.", "William Brownfield"], null),
      mc("In what year was JCI founded?", 1, ["1910", "1914", "1915", "1916"], null),
      mc("What is the age range for JCI membership?", 1, ["18–35", "18–40", "21–40", "18–45"], null),
      mc("The JCI Mission is to:", 1, ["Provide leadership opportunities that inspire young people to create positive change.", "Provide leadership development opportunities that empower young people to create positive change.", "Provide entrepreneurial development opportunities that empower young leaders.", "Develop leadership skills that transform young people into entrepreneurs."], null),
      mc("JCI is a:", 1, ["Leadership and civic organisation", "Leadership development organisation", "Youth leadership movement", "Civic empowerment organisation"], null),
      mc("Which of these is NOT a benefit of being a JCI member?", 1, ["Leadership development", "Networking opportunities", "Guaranteed employment", "Community impact"], null),
      mc("The JCI Creed was written by:", 1, ["William Brown", "C. William Brownfield", "William Bradford", "Henry Giessenbier Jr."], null),
      mc("JCI started as a:", 1, ["Social Club", "Dance Club", "Civic Club", "Youth Club"], null),
      mc("The first National President of JCI Nigeria was:", 1, ["Pascal Dike", "Kunbi Wuraola", "Tony Abolo", "Bola Otunba Adewumi"], null),
      mc("The JCI Vision is:", 1, ["To be the foremost global network of young leaders.", "To become the leading youth organisation in the world.", "To be the world's leading network of active citizens.", "To empower young leaders to change the world."], null),
      mc("JCI was brought to UNIBEN in:", 1, ["1978", "1979", "1980", "1981"], null),
      mc("JCIN UNIBEN is a:", 1, ["Campus Chapter", "Collegiate Chapter", "Local Chapter", "Participant Chapter"], null),
      mc("What does the third line of the JCI Creed say?", 1, ["That economic justice can best be won by free men through free enterprise.", "That economic freedom can best be achieved through enterprise.", "That free enterprise creates economic justice.", "That economic justice comes through equal opportunity."], null),
      mc("In what year was the JCI Creed officially adopted?", 1, ["1946", "1947", "1948", "1949"], null),
      mc("The first Nigerian to become JCI World President was:", 1, ["Tony Abolo", "Pascal Dike", "Kunbi Wuraola", "Bola Otunba Adewumi"], null),
      mc("The JCI Creed contains:", 1, ["Five beliefs", "Six beliefs", "Seven beliefs", "Eight beliefs"], null),
      mc("According to the Creed, service to humanity is:", 1, ["The highest responsibility of mankind.", "The best work of life.", "The greatest act of kindness.", "The foundation of leadership."], null),
      mc("JCI was introduced to Nigeria in:", 1, ["1955", "1956", "1957", "1958"], null),
      mc("Approximately how many young men started the organisation?", 1, ["28", "30", "32", "35"], null),
      mc("In 1915, the organisation became:", 1, ["Young Men's Progressive Civic Association", "Young Men's Civic Association", "Progressive Young Men's Association", "Junior Chamber Association"], null),
      mc("In what year did the organisation become the Junior Chamber of Commerce?", 1, ["1915", "1916", "1917", "1920"], null),
      mc("The first National Convention was held in:", 1, ["1918", "1919", "1920", "1921"], null),
      mc("Which name came immediately after \"Young Men's Progressive Civic Association\"?", 1, ["Junior Chamber of Commerce", "Junior Chamber International", "Junior Civic Chamber", "Young Chamber of Commerce"], null),
      mc("How many Areas of Opportunity does JCI have?", 1, ["Three", "Four", "Five", "Six"], null),
      mc("Which of the following is NOT one of the Areas of Opportunity?", 1, ["Individual Development", "Community Development", "Business Development", "Political Development"], null),
      mc("Which Area of Opportunity focuses on creating partnerships beyond national borders?", 1, ["International Cooperation", "International Development", "Global Relations", "International Partnership"], null),
      mc("Before discussing a proposal, a member must first:", 1, ["Move a motion", "Raise an objection", "Request permission", "Call for a vote"], null),
      mc("A motion must be:", 1, ["Supported", "Seconded", "Approved", "Confirmed"], null),
      mc("Who presides over a meeting?", 1, ["LOP", "LOT", "LOS", "Sergeant-at-Arms"], null),
      mc("The purpose of Parliamentary Procedure is to protect:", 1, ["The rights of the Chair only.", "The rights of both the majority and the minority.", "The rights of executives.", "The rights of committee chairmen."], null),
      mc("Which of the following is used to end a meeting?", 1, ["Motion to Adjourn", "Motion to Suspend", "Motion to Close Debate", "Motion to Reconsider"], null),
      mc("One of the greatest responsibilities of a leader is to:", 1, ["Guide others through service.", "Serve others.", "Inspire others through authority.", "Direct members effectively."], null),
      mc("Effective leaders are good:", 1, ["Speakers", "Listeners", "Negotiators", "Decision-makers"], null),
      mc("Leadership without integrity leads to:", 1, ["Loss of confidence", "Distrust", "Poor communication", "Weak leadership"], null),
      mc("Which skill is essential for every leader?", 1, ["Public Speaking", "Communication", "Negotiation", "Critical Thinking"], null),
      mc("During an official JCI meeting, members are expected to dress:", 1, ["Smart Casual", "Corporate/Formal", "Business Casual", "Traditional Attire"], null),
      mc("A member who attends a meeting inappropriately dressed may be subject to:", 1, ["A warning", "A fine", "A disciplinary measure in accordance with the Local Organisation's rules", "Suspension"], null),
      mc("Which of these best reflects the values of JCI?", 1, ["Leadership, Service and Responsibility", "Leadership, Service, Responsibility and Integrity", "Service, Responsibility and Teamwork", "All of the above"], null),
      mc("Which skill is important for every JCI member?", 1, ["Communication", "Leadership", "Public Speaking", "All of the above"], null),
      mc("The ultimate goal of JCI is to empower young people to:", 1, ["Become global leaders.", "Create positive change.", "Build successful businesses.", "Become influential professionals."], null)
    ]
  }
];

/**
 * @param {QuestionSpec} spec
 * @param {number} number   unique number used to derive the question and option ids
 * @param {number} order
 */
function buildQuestion(spec, number, order) {
  const questionId = id('20000000', number);
  /** @type {Record<string, any>} */
  const question = {
    id: questionId,
    type: spec.type,
    order,
    text: spec.text,
    explanation: null,
    marks: spec.marks,
    image: spec.image ? {
      assetId: spec.image.assetId,
      url: DEMO_ASSETS[spec.image.assetId] || RETIRED_ASSET_URL,
      alt: spec.image.alt,
      decorative: false,
      placement: 'above',
      size: 'small'
    } : null,
    appearance: spec.look || {},
    source: spec.source || null
  };
  if (spec.options) {
    question.options = spec.options.map((text, index) => ({
      id: id('30000000', number * 10 + index + 1),
      text,
      image: null,
      isCorrect: (spec.correct || []).includes(index)
    }));
  }
  if (spec.type === 'short_answer') {
    question.acceptedAnswers = spec.accepted || [];
    question.caseSensitive = false;
    question.maxLength = 200;
  }
  if (spec.type === 'paragraph') {
    question.maxLength = 2000;
    question.gradingNotes = spec.notes || '';
  }
  return question;
}

/** Demo-only copy of the preset colours (the real list lives in js/quiz/appearance.js). @param {string} [preset] */
function presetColors(preset) {
  const colors = {
    'jci-classic': ['#EEF6FB', '#FFFFFF', '#130F2D'],
    'jci-bold': ['#130F2D', '#FFFFFF', '#130F2D'],
    ocean: ['#0097D7', '#FFFFFF', '#130F2D'],
    night: ['#0B0A14', '#17152A', '#F5F6FA'],
    paper: ['#F7F3EA', '#FFFDF8', '#2B2A28']
  };
  const [pageBackground, cardBackground, textColor] = colors[/** @type {keyof typeof colors} */ (preset || 'jci-classic')] || colors['jci-classic'];
  return { pageBackground, cardBackground, textColor };
}

/**
 * Build the demo quizzes in the backend's proposed JSON shape.
 * @param {number} [now] epoch ms
 */
export function createDemoQuizzes(now = Date.now()) {
  /**
   * A whole hour in the browser's time zone, so dates read naturally:
   * quizzes open at 09:00 and close at 17:00.
   * @param {number} days
   * @param {number} hour
   */
  const at = (days, hour) => {
    const date = new Date(now + days * DAY);
    date.setHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  return QUIZ_SPECS.map((spec, quizIndex) => {
    const quizId = id('10000000', quizIndex + 1);
    const questions = spec.questions.map((questionSpec, index) =>
      buildQuestion(questionSpec, (quizIndex + 1) * 100 + index + 1, index + 1));
    return {
      id: quizId,
      title: spec.title,
      description: spec.description,
      instructions: spec.questions.length ? 'Answer every question. You can change your answers until you submit.' : '',
      status: spec.status,
      settings: {
        durationMinutes: spec.duration ?? null,
        opensAt: spec.opens === undefined || spec.opens === null ? null : at(spec.opens, 9),
        closesAt: spec.closes === undefined || spec.closes === null ? null : at(spec.closes, 17),
        maxAttempts: spec.maxAttempts === undefined ? 1 : spec.maxAttempts,
        attemptScoring: 'highest',
        checkboxScoring: 'all_or_nothing',
        resultVisibility: spec.results || (spec.closes === undefined || spec.closes === null ? 'manual' : 'after_close'),
        showCorrectAnswers: false,
        shortAnswerCaseSensitive: false
      },
      appearance: {
        fontFamily: 'Inter', fontSize: 18, bold: false, italic: false, underline: false, align: 'left',
        ...presetColors(spec.preset),
        ...(spec.look || {})
      },
      questions,
      attemptCount: spec.attempts,
      version: 1 + Math.round(spec.created / 7),
      createdAt: new Date(now - spec.created * DAY).toISOString(),
      updatedAt: new Date(now - spec.updated * DAY).toISOString(),
      publishedAt: spec.status === 'published' && spec.opens !== undefined && spec.opens !== null
        ? new Date(now - Math.max(1, -spec.opens) * DAY).toISOString()
        : null
    };
  });
}

// Question Bank (Stage 8) --------------------------------------------------------
// Thirteen reusable questions. Some are used by the demo quizzes above (their
// quiz copies point back here with `source`), and a few have moved on to a
// newer version, so "Newer version available" and "Review update" can be tried.

/**
 * @typedef {Object} BankSpec
 * @property {QuestionSpec} spec
 * @property {string[]} tags
 * @property {number} version
 * @property {number} created   days ago
 * @property {number} updated   days ago
 * @property {string} [explanation]
 * @property {'active' | 'archived'} [status]
 * @property {Record<string, unknown>} [look]
 */

/** @type {BankSpec[]} */
const BANK_SPECS = [
  { spec: mc('What does JCI stand for?', 2, ['Junior Chamber International', 'Joint Council of Innovators', 'Junior Citizens Initiative', 'Journal of Community Impact'], 0), tags: ['JCI basics'], version: 2, created: 60, updated: 4,
    explanation: 'JCI began in 1915 in St. Louis, USA, and is now active in over 100 countries.' },
  { spec: sa('In what year did the JCI movement begin?', 2, ['1915']), tags: ['JCI basics', 'History'], version: 1, created: 60, updated: 60 },
  { spec: mc('What is the first phase of a project life cycle?', 2, ['Initiation', 'Planning', 'Execution', 'Closing'], 0), tags: ['Projects'], version: 2, created: 30, updated: 1 },
  { spec: cb('Which of these belong in a project plan?', 3, ['Goals', 'Timeline', 'Budget', 'Members’ passwords'], [0, 1, 2]), tags: ['Projects'], version: 1, created: 30, updated: 30 },
  { spec: mc('Which stage of team development comes after “Forming”?', 2, ['Storming', 'Norming', 'Performing', 'Adjourning'], 0), tags: ['Teamwork'], version: 1, created: 40, updated: 40 },
  { spec: mc('What should every meeting have before it starts?', 2, ['A clear agenda', 'A long guest list', 'Refreshments', 'A projector'], 0), tags: ['Meetings'], version: 1, created: 12, updated: 12 },
  { spec: pa('Describe a time you led a team through a difficult decision. What did you learn?', 5, 'Look for the situation, the decision, and an honest reflection.'), tags: ['Leadership'], version: 1, created: 9, updated: 9 },
  { spec: mc('Which leadership style involves the team in decisions?', 2, ['Democratic', 'Autocratic', 'Laissez-faire', 'Transactional'], 0), tags: ['Leadership'], version: 3, created: 25, updated: 3 },
  { spec: sa('What does “SDG” stand for?', 1, ['Sustainable Development Goals', 'Sustainable Development Goal']), tags: ['SDGs'], version: 1, created: 50, updated: 50 },
  { spec: cb('Which of these are UN Sustainable Development Goals?', 3, ['No Poverty', 'Quality Education', 'Faster Internet', 'Climate Action'], [0, 1, 3]), tags: ['SDGs'], version: 1, created: 50, updated: 20 },
  { spec: mc('What is the strongest way to open a speech?', 2, ['A clear hook that grabs attention', 'An apology for being nervous', 'Reading your slides aloud', 'A long list of thank-yous'], 0), tags: ['Public speaking'], version: 1, created: 15, updated: 15,
    look: { cardBackground: '#FFFDF8', fontFamily: 'Lora' } },
  { spec: pa('Write a two-minute introduction for a guest speaker at a chapter meeting.', 4), tags: ['Public speaking'], version: 2, created: 15, updated: 6 },
  { spec: cb('Which are the four JCI Areas of Opportunity?', 4, ['Individual', 'Business', 'Community', 'International'], [0, 1, 2, 3]), tags: ['JCI basics'], version: 1, created: 90, updated: 70, status: 'archived' }
];

/**
 * The demo Question Bank in the backend's proposed JSON shape
 * (usedInQuizCount is worked out by the demo server from the quizzes).
 * @param {number} [now] epoch ms
 */
export function createDemoBank(now = Date.now()) {
  return BANK_SPECS.map((entry, index) => {
    const n = index + 1;
    const built = buildQuestion({ ...entry.spec, look: entry.look }, 900 + n, 0);
    const { order, source, ...question } = built;
    return {
      ...question,
      id: bankId(n),
      options: question.options?.map((/** @type {any} */ option, /** @type {number} */ i) => ({ ...option, id: id('50000000', n * 10 + i + 1) })),
      explanation: entry.explanation || null,
      tags: entry.tags,
      status: entry.status || 'active',
      version: entry.version,
      createdAt: new Date(now - entry.created * DAY).toISOString(),
      updatedAt: new Date(now - entry.updated * DAY).toISOString()
    };
  });
}

// Results (Stage 9) ---------------------------------------------------------------
// Clearly fake participants (".test" email addresses) and their attempts, made
// to match each demo quiz's attempt count. Generated the same way every time
// (a seeded random sequence), so the demo looks the same on every reset.

const FIRST_NAMES = ['Amaka', 'Tunde', 'Chidi', 'Ifeoma', 'Kelechi', 'Zainab', 'Osaro', 'Funmi', 'Emeka', 'Aisha', 'Efe', 'Bisola', 'Uche', 'Halima', 'Ehis'];
const LAST_NAMES = ['Okafor', 'Adeyemi', 'Eze', 'Bello', 'Osagie', 'Nwosu', 'Ibrahim', 'Igbinedion', 'Okonkwo', 'Lawal'];

/** 150 demo participants: every first name with every last name. */
export const DEMO_PARTICIPANTS = Object.freeze(FIRST_NAMES.flatMap((first, i) => LAST_NAMES.map((last, j) => Object.freeze({
  id: id('70000000', i * LAST_NAMES.length + j + 1),
  name: `${first} ${last}`,
  email: `${first}.${last}@participants.demo.test`.toLowerCase()
}))));

/** @param {number} seed a small, repeatable random sequence */
function seeded(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Demo paragraph answers that fit their question (found by a word in it). */
const PARAGRAPH_ANSWERS = [
  ['active citizenship', 'Being an active citizen means taking responsibility for my community. For example, our chapter organised a clean-up of the faculty road last semester and I led the volunteers.'],
  ['join JCI', 'I joined to build my confidence and meet people who want to make a difference. In my first year I hope to lead at least one project and get better at public speaking.'],
  ['disagreement', 'In my final-year project group, two members disagreed about the topic. I asked each of them to explain their reasons, we listed the pros and cons together, then voted.\n\nI learned that people accept a decision more easily when they feel heard.'],
  ['difficult decision', 'As project lead I had to cancel an outdoor event because of the rain forecast. I explained the reasons to the team, we moved it a week later, and turnout was better than planned.'],
  ['speech', 'Imagine walking past the same problem every day, knowing you could fix it in one Saturday morning. That is what volunteering is: small hours, big change.'],
  ['SDG', 'SDG 4, Quality Education. We could run a Saturday reading club for primary pupils in Ugbowo, with members as reading partners and a small book drive to stock a shelf.'],
  ['risks', 'Risks: low turnout, injuries and waste disposal. I would publicise early, provide gloves and first aid, and partner with the local council for collection.'],
  ['lead and how you would measure', 'A blood donation drive with the university health centre. I would measure impact by the number of donors, the units collected, and how many first-time donors come back.'],
  ['quiet team member', 'I would start by asking them for their ideas in a small group, then give them a clear role so they feel their contribution matters.'],
  ['past chapter project', 'The tree planting at the main gate, because people still talk about it and the trees are growing. It showed that a simple project can leave something lasting.'],
  ['inducted', 'It means I am now part of a global network of young people who act instead of complaining. I feel proud, and responsible for living up to the Creed.'],
  ['guest speaker', 'Good evening, everyone. Our guest tonight has spent ten years building youth programmes across Edo State. Please join me in welcoming her.']
];
const WEAK_PARAGRAPHS = ['Leadership is service.', 'I am not sure, but I think it is about helping people and being on time.', 'I don’t really know how to answer this one.'];
/** @param {string} question @param {() => number} random */
function paragraphAnswer(question, random) {
  const fit = PARAGRAPH_ANSWERS.find(([word]) => question.toLowerCase().includes(word.toLowerCase()));
  return fit && random() < 0.75 ? fit[1] : WEAK_PARAGRAPHS[Math.floor(random() * WEAK_PARAGRAPHS.length)];
}
const SHORT_WRONG = ['I don’t know', 'Not sure', 'Key Performance Index', '1920'];

/**
 * Demo attempts for every quiz that has some (API shape, answers included).
 * @param {any[]} quizzes   the demo quizzes (API shape)
 * @param {{ recompute: (attempt: any, quiz: any) => any, markFinals: (attempts: any[], quiz: any) => any }} grading
 * @param {number} [now]
 */
export function createDemoAttempts(quizzes, grading, now = Date.now()) {
  /** @type {any[]} */
  const all = [];
  let counter = 0;
  quizzes.forEach((quiz, quizIndex) => {
    if (!quiz.attemptCount || !quiz.questions.length) return;
    const random = seeded(1000 + quizIndex * 7919);
    const pick = (/** @type {any[]} */ list) => list[Math.floor(random() * list.length)];
    const opens = quiz.settings.opensAt ? Date.parse(quiz.settings.opensAt) : Date.parse(quiz.createdAt);
    const closes = Math.min(quiz.settings.closesAt ? Date.parse(quiz.settings.closesAt) : now, now);
    const span = Math.max(HOUR, closes - opens - HOUR);
    const isOpen = quiz.status === 'published' && closes >= now - 1000 && (!quiz.settings.closesAt || Date.parse(quiz.settings.closesAt) > now);
    const repeatable = quiz.settings.maxAttempts === null || quiz.settings.maxAttempts > 1;
    // Who takes it: a shuffled slice of the participant pool, some twice when allowed.
    const pool = DEMO_PARTICIPANTS.slice().sort(() => random() - 0.5);
    /** @type {any[]} */
    const takers = [];
    let p = 0;
    while (takers.length < quiz.attemptCount) {
      const person = pool[p % pool.length];
      takers.push(person);
      if (repeatable && random() < 0.2 && takers.length < quiz.attemptCount) takers.push(person);
      p += 1;
    }
    /** @type {any[]} */
    const quizAttempts = [];
    /** @type {Map<string, number>} */
    const counts = new Map();
    takers.forEach((person, i) => {
      const started = opens + Math.floor((span * (i + random())) / takers.length);
      const minutes = 4 + Math.floor(random() * Math.max(6, (quiz.settings.durationMinutes || 25) - 3));
      const inProgress = isOpen && i >= takers.length - 2;   // a couple still taking it right now
      const submitted = inProgress ? null : Math.min(started + minutes * 60000, now - 60000);
      const skill = 0.45 + random() * 0.5;
      const answers = quiz.questions.map((/** @type {any} */ q) => {
        const answer = { questionId: q.id, selectedOptionIds: /** @type {string[]} */ ([]), text: /** @type {string | null} */ (null), autoMarks: null, manualMarks: /** @type {number | null} */ (null), feedback: /** @type {string | null} */ (null), needsManualGrading: false };
        if (random() < 0.04) return answer;   // left blank
        if (q.type === 'multiple_choice') {
          const correct = q.options.find((/** @type {any} */ o) => o.isCorrect);
          answer.selectedOptionIds = [random() < skill && correct ? correct.id : pick(q.options).id];
        } else if (q.type === 'checkboxes') {
          answer.selectedOptionIds = random() < skill
            ? q.options.filter((/** @type {any} */ o) => o.isCorrect).map((/** @type {any} */ o) => o.id)
            : q.options.filter(() => random() < 0.5).map((/** @type {any} */ o) => o.id);
        } else if (q.type === 'short_answer') {
          const accepted = q.acceptedAnswers || [];
          answer.text = accepted.length && random() < skill ? (random() < 0.5 ? pick(accepted).toLowerCase() : ` ${pick(accepted)} `) : pick(SHORT_WRONG);
        } else {
          answer.text = paragraphAnswer(q.text, random);
          // Older attempts have mostly been graded already; recent ones are waiting.
          const age = now - started;
          if (!inProgress && random() < (age > 5 * DAY ? 0.85 : 0.35)) {
            answer.manualMarks = Math.round(q.marks * (0.4 + random() * 0.6) * 2) / 2;
            answer.feedback = random() < 0.5 ? pick(['Good examples.', 'Clear and well argued.', 'Needs a concrete example.', 'Answer the whole question next time.']) : null;
          }
        }
        return answer;
      });
      const number = (counts.get(person.id) || 0) + 1;
      counts.set(person.id, number);
      counter += 1;
      const attempt = {
        id: id('60000000', counter),
        quizId: quiz.id,
        participant: { ...person },
        attemptNumber: number,
        status: inProgress ? 'in_progress' : 'submitted',
        startedAt: new Date(started).toISOString(),
        submittedAt: submitted === null ? null : new Date(submitted).toISOString(),
        score: null,
        maxScore: 0,
        isFinal: false,
        answers
      };
      grading.recompute(attempt, quiz);
      quizAttempts.push(attempt);
    });
    grading.markFinals(quizAttempts, quiz);
    all.push(...quizAttempts);
  });
  return all;
}
