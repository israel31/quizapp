// @ts-check
/**
 * Stages 5 and 6: appearance inheritance, presets and contrast; the renderer
 * (safe text, admin-only data only when asked); settings rules and what may
 * change once participants have started; publish checks; adapters; demo server.
 */
import { test, assert, assertEqual, assertRejects } from './harness.js';
import {
  PRESETS, DEFAULT_APPEARANCE, FONT_SIZES, normalizeHex, sanitizeAppearance, sanitizeOverrides, resolveAppearance,
  optionFontSize, contrastRatio, requiredContrast, contrastCheck, suggestReadableColor, matchPreset, applyPreset, formatRatio
} from '../quiz/appearance.js';
import { renderQuestion, renderQuiz } from '../quiz/renderer.js';
import { settingsIssues, lockedSettingsProblem, isoToLocalInput, localInputToIso } from '../quiz/settings-rules.js';
import { publishIssues } from '../quiz/publish-checks.js';
import { quizPatchToApi, appearanceFromApi, settingsFromApi, questionFromApi } from '../api/adapters.js';
import { ApiError } from '../api/client.js';
import * as mock from '../api/mock/mock-api.js';

/** @typedef {import('../types.js').QuizSettings} QuizSettings */

/** @type {QuizSettings} */
const SETTINGS = { durationMinutes: null, opensAt: null, closesAt: null, maxAttempts: 1, attemptScoring: 'highest', checkboxScoring: 'all_or_nothing', resultVisibility: 'immediately', showCorrectAnswers: false, shortAnswerCaseSensitive: false };
const NOW = new Date('2026-10-29T12:00:00Z');
const question = (/** @type {any} */ overrides = {}) => ({
  id: 'q1', type: 'multiple_choice', order: 1, text: 'Pick one', explanation: null, marks: 2, image: null, appearance: {}, source: null,
  options: [{ id: 'a', text: 'Alpha', image: null, isCorrect: true }, { id: 'b', text: 'Beta', image: null, isCorrect: false }],
  ...overrides
});

/* Appearance ------------------------------------------------------------------- */
test('appearance: the six presets match the brief, and new quizzes start with JCI Classic', () => {
  assertEqual(PRESETS.map((p) => [p.name, p.pageBackground, p.cardBackground, p.textColor]), [
    ['JCI Classic', '#EEF6FB', '#FFFFFF', '#130F2D'],
    ['JCI Bold', '#130F2D', '#FFFFFF', '#130F2D'],
    ['Ocean', '#0097D7', '#FFFFFF', '#130F2D'],
    ['Night', '#0B0A14', '#17152A', '#F5F6FA'],
    ['Paper', '#F7F3EA', '#FFFDF8', '#2B2A28'],
    ['High contrast', '#FFFFFF', '#FFFFFF', '#000000']
  ]);
  assertEqual(matchPreset(DEFAULT_APPEARANCE)?.id, 'jci-classic');
  assertEqual(FONT_SIZES, [14, 16, 18, 20, 24, 28]);
});

test('appearance: colours are typed as #abc or #aabbcc; anything else is refused', () => {
  assertEqual([normalizeHex('#abc'), normalizeHex('0097d7'), normalizeHex(' #130F2D ')], ['#AABBCC', '#0097D7', '#130F2D']);
  for (const bad of ['', '#12', 'blue', '#GGGGGG', 'rgb(0,0,0)', '#1234567']) assertEqual(normalizeHex(bad), null, bad);
});

test('appearance: bad values fall back to the defaults, never break the page', () => {
  const clean = sanitizeAppearance({ fontFamily: 'Comic Sans', fontSize: 99, textColor: 'red', pageBackground: '#000', align: 'justify', bold: 'yes' });
  assertEqual([clean.fontFamily, clean.fontSize, clean.textColor, clean.pageBackground, clean.align, clean.bold], ['Inter', 18, '#130F2D', '#000000', 'left', false]);
  assertEqual(sanitizeOverrides({ textColor: '#fff', pageBackground: '#000', made: 'up', fontSize: 15 }), { textColor: '#FFFFFF' }, 'page background is quiz-wide only; unknown keys dropped');
});

test('appearance: a question inherits everything it doesn’t override', () => {
  const quiz = { ...DEFAULT_APPEARANCE, fontFamily: 'Lora' };
  const effective = resolveAppearance(quiz, { textColor: '#0097D7', bold: true });
  assertEqual([effective.fontFamily, effective.textColor, effective.bold, effective.cardBackground], ['Lora', '#0097D7', true, '#FFFFFF']);
  const changedQuiz = resolveAppearance({ ...quiz, fontFamily: 'Poppins', textColor: '#000000' }, { textColor: '#0097D7' });
  assertEqual([changedQuiz.fontFamily, changedQuiz.textColor], ['Poppins', '#0097D7'], 'quiz change flows down; the override stays');
  assertEqual(resolveAppearance(quiz, {}), sanitizeAppearance(quiz), 'empty overrides = inherit everything');
});

test('appearance: answer options are a little smaller than the question', () => {
  assertEqual(FONT_SIZES.map(optionFontSize), [14, 14, 15, 17, 20, 24]);
});

test('appearance: contrast follows WCAG, with the large-text rule', () => {
  assertEqual(Math.round(contrastRatio('#000000', '#FFFFFF') * 10) / 10, 21);
  assertEqual(Math.round(contrastRatio('#777777', '#FFFFFF') * 100) / 100, 4.48);
  assertEqual([requiredContrast({ fontSize: 18, bold: false }), requiredContrast({ fontSize: 24, bold: false }), requiredContrast({ fontSize: 20, bold: true }), requiredContrast({ fontSize: 18, bold: true })], [4.5, 3, 3, 4.5]);
  const low = contrastCheck(resolveAppearance({ ...DEFAULT_APPEARANCE, textColor: '#9CA3AF' }));
  assert(!low.ok && low.message.startsWith('Hard to read: contrast 2.5:1 (aim for 4.5:1)'), low.message);
  assertEqual(formatRatio(4.4999), '4.4:1', 'rounded down, so failing never reads as passing');
  const big = contrastCheck(resolveAppearance({ ...DEFAULT_APPEARANCE, textColor: '#888888', fontSize: 24 }));
  assert(big.ok, '24px text needs only 3:1');
});

test('appearance: the readable suggestion passes and keeps the hue', () => {
  const light = suggestReadableColor('#7FC8F0', '#FFFFFF', 4.5);
  assert(contrastRatio(light, '#FFFFFF') >= 4.5, `${light} passes on white`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(light.slice(i, i + 2), 16));
  assert(b > r && b >= g, `${light} is still blue`);
  const dark = suggestReadableColor('#2A2650', '#17152A', 4.5);
  assert(contrastRatio(dark, '#17152A') >= 4.5, `${dark} passes on the Night card`);
  assertEqual(suggestReadableColor('#130F2D', '#FFFFFF'), '#130F2D', 'already fine: unchanged');
});

test('appearance: presets change colours only; fonts and formatting stay', () => {
  const start = { ...DEFAULT_APPEARANCE, fontFamily: 'Nunito', bold: true };
  const night = applyPreset(start, 'night');
  assertEqual([night.pageBackground, night.cardBackground, night.textColor, night.fontFamily, night.bold], ['#0B0A14', '#17152A', '#F5F6FA', 'Nunito', true]);
  assertEqual(matchPreset({ ...night, textColor: '#FFFFFF' }), null, 'edited colours no longer match a preset');
});

/* Renderer ---------------------------------------------------------------------- */
test('renderer: question text is never parsed as HTML', () => {
  const card = renderQuestion(question({ text: '<img src=x onerror="window.__pwned=1">Hi', options: [{ id: 'a', text: '<b>bold</b>', image: null, isCorrect: true }] }), DEFAULT_APPEARANCE);
  assert(!card.querySelector('img') && !card.querySelector('b'), 'no elements created from text');
  assert((card.querySelector('.qr-card__text')?.textContent || '').startsWith('<img'), 'shown as text');
});

test('renderer: correct answers appear only with the admin overlay', () => {
  const short = question({ type: 'short_answer', options: undefined, acceptedAnswers: ['Abuja'], gradingNotes: '' });
  const hidden = renderQuestion(question(), DEFAULT_APPEARANCE, { interactive: true });
  const shown = renderQuestion(question(), DEFAULT_APPEARANCE, { interactive: true, showCorrect: true });
  assert(!hidden.querySelector('.qr-badge, .is-correct') && !(hidden.textContent || '').includes('Correct'), 'nothing marked without the overlay');
  assert(Boolean(shown.querySelector('.qr-option.is-correct .qr-badge')), 'the overlay marks the right option');
  assert(!(renderQuestion(short, DEFAULT_APPEARANCE, { interactive: true }).textContent || '').includes('Abuja'), 'accepted answers hidden');
  assert((renderQuestion(short, DEFAULT_APPEARANCE, { showCorrect: true }).textContent || '').includes('Abuja'), 'accepted answers in the overlay');
});

test('renderer: each card carries its own effective look', () => {
  const card = renderQuestion(question({ appearance: { cardBackground: '#FFF7E6', fontSize: 24 } }), { ...DEFAULT_APPEARANCE, fontFamily: 'Lora' });
  assertEqual([card.style.getPropertyValue('--qr-card-bg'), card.style.getPropertyValue('--qr-size'), card.style.getPropertyValue('--qr-option-size')], ['#FFF7E6', '24px', '20px']);
  assert(card.style.getPropertyValue('--qr-font').includes('Lora'), 'quiz font inherited');
});

test('renderer: one question at a time, with progress and answers kept', () => {
  const quiz = { title: 'Q', description: '', instructions: '', appearance: DEFAULT_APPEARANCE, settings: { durationMinutes: 10 }, questions: [question(), question({ id: 'q2', text: 'Second' })] };
  const answers = new Map();
  const page = renderQuiz(quiz, { layout: 'one', answers });
  document.body.append(page);   // inputs only report changes when they're on the page
  page.hidden = true;
  assertEqual(page.querySelectorAll('.qr-question').length, 1);
  assertEqual(page.querySelector('.qr-progress__text')?.textContent, 'Question 1 of 2');
  /** @type {HTMLInputElement} */ (page.querySelector('.qr-option__input')).click();
  /** @type {HTMLButtonElement} */ ([...page.querySelectorAll('.qr-button')].find((b) => b.textContent === 'Next')).click();
  assertEqual(page.querySelector('.qr-card__text')?.textContent, 'Second');
  assertEqual(answers.get('q1')?.selected, ['a'], 'the answer to question 1 is kept');
  assert((page.textContent || '').includes('Time limit: 10 minutes'), 'intro shows the time limit');
  page.remove();
});

/* Settings ----------------------------------------------------------------------- */
test('settings: every rule in section 20', () => {
  const ids = (/** @type {Partial<QuizSettings>} */ s) => settingsIssues({ ...SETTINGS, ...s }, { now: NOW }).map((i) => `${i.level}:${i.id}`);
  assertEqual(ids({ closesAt: '2026-12-01T10:00:00Z' }), []);
  assertEqual(ids({ opensAt: '2026-11-02T10:00:00Z', closesAt: '2026-11-01T10:00:00Z' }), ['error:closes-before-opens']);
  assertEqual(ids({ closesAt: '2026-10-01T10:00:00Z' }), ['error:closes-past']);
  assertEqual(ids({ resultVisibility: 'after_close' }), ['error:results-no-close', 'warning:no-close']);
  assertEqual(ids({ maxAttempts: 0, closesAt: '2026-12-01T10:00:00Z' }), ['error:attempts-min']);
  assertEqual(ids({ durationMinutes: 90, opensAt: '2026-11-01T10:00:00Z', closesAt: '2026-11-01T11:00:00Z' }), ['warning:duration-window']);
  assertEqual(ids({ opensAt: '2026-10-01T10:00:00Z', closesAt: '2026-12-01T10:00:00Z' }), ['info:opens-past']);
  assertEqual(ids({ durationMinutes: 0, closesAt: '2026-12-01T10:00:00Z' }), ['error:duration-invalid']);
});

test('settings: once participants have started, only these may change', () => {
  const saved = { ...SETTINGS, closesAt: '2026-11-10T16:00:00Z' };
  assertEqual(lockedSettingsProblem(saved, { ...saved, resultVisibility: 'manual', showCorrectAnswers: true }), null);
  assertEqual(lockedSettingsProblem(saved, { ...saved, closesAt: '2026-11-20T16:00:00Z' }), null, 'a later close time is fine');
  assert(Boolean(lockedSettingsProblem(saved, { ...saved, closesAt: '2026-11-05T16:00:00Z' })), 'an earlier close time is not');
  assert(Boolean(lockedSettingsProblem(saved, { ...saved, durationMinutes: 30 })), 'the time limit is locked');
  assert(Boolean(lockedSettingsProblem(SETTINGS, { ...SETTINGS, closesAt: '2026-11-20T16:00:00Z' })), 'adding a close time would cut the quiz short');
});

test('settings: times are shown in local time and sent in UTC', () => {
  const iso = '2026-11-01T09:30:00.000Z';
  assertEqual(localInputToIso(isoToLocalInput(iso)), iso);
  assertEqual([isoToLocalInput(null), localInputToIso('')], ['', null]);
});

test('publish checks: settings blockers and low-contrast warnings', () => {
  const base = { title: 'Q', description: 'D', instructions: 'I', questions: [question()], settings: { ...SETTINGS, closesAt: '2026-12-01T10:00:00Z' }, appearance: DEFAULT_APPEARANCE };
  assertEqual(publishIssues({ ...base, settings: { ...SETTINGS, resultVisibility: 'after_close' } }, { now: NOW }).blockers.map((b) => [b.id, b.tab, b.field]), [['results-no-close', 'settings', 'resultVisibility']]);
  const pale = publishIssues({ ...base, appearance: { ...DEFAULT_APPEARANCE, textColor: '#BBBBBB' } }, { now: NOW });
  assertEqual(pale.warnings.map((w) => w.id), ['contrast'], 'one warning for the quiz, not one per question');
  const custom = publishIssues({ ...base, questions: [question(), question({ id: 'q2', appearance: { textColor: '#EEEEEE' } })] }, { now: NOW });
  assertEqual(custom.warnings.map((w) => [w.id, w.questionId, w.target]), [['q2-contrast', 'q2', 'appearance']]);
  assertEqual(custom.blockers, [], 'contrast never blocks publishing');
});

/* Adapters and the demo server ------------------------------------------------------- */
test('adapters: settings and appearance are sent whole and validated', () => {
  const body = quizPatchToApi({ settings: { ...SETTINGS, opensAt: '2026-11-01T10:00:00+01:00' }, appearance: { ...DEFAULT_APPEARANCE, textColor: '#abc' } }, 4);
  assertEqual(body.version, 4);
  assertEqual(/** @type {any} */ (body.settings).opensAt, '2026-11-01T09:00:00.000Z', 'times converted to UTC');
  assertEqual(/** @type {any} */ (body.appearance).textColor, '#AABBCC');
  assertEqual(appearanceFromApi({ font_family: 'Merriweather', font_size: 20, text_color: '#000' }).fontFamily, 'Merriweather');
  assertEqual(settingsFromApi({ short_answer_case_sensitive: true }).shortAnswerCaseSensitive, true);
  assertEqual(questionFromApi({ id: 'x', type: 'paragraph', appearance: { textColor: '#fff', evil: '<script>' } }).appearance, { textColor: '#FFFFFF' });
});

test('demo server: locked quizzes accept only the allowed setting changes', async () => {
  const KEY = 'jci-mock:session';
  const before = localStorage.getItem(KEY);
  localStorage.setItem(KEY, JSON.stringify({ admin: { id: 't', name: 'Test', email: 't@t.co', role: 'admin' } }));
  try {
    const page = await mock.listQuizzes({ status: 'published', pageSize: 50 });
    const summary = page.items.find((q) => q.attemptCount > 0 && q.settings.closesAt && Date.parse(q.settings.closesAt) > Date.now());
    assert(Boolean(summary), 'demo data has a locked, open quiz');
    if (!summary) return;
    const quiz = await mock.getQuiz(summary.id);
    await assertRejects(() => mock.updateQuiz(quiz.id, { settings: { ...quiz.settings, durationMinutes: 99 } }, { version: quiz.version }),
      (e) => e instanceof ApiError && e.status === 422 && e.code === 'SETTINGS_LOCKED', 'time limit locked');
    const later = new Date(Date.parse(/** @type {string} */ (quiz.settings.closesAt)) + 86400000).toISOString();
    const saved = await mock.updateQuiz(quiz.id, { settings: { ...quiz.settings, closesAt: later, resultVisibility: 'manual' }, appearance: { ...quiz.appearance, fontFamily: 'Lora' } }, { version: quiz.version });
    assertEqual([saved.settings.closesAt, saved.settings.resultVisibility, saved.appearance.fontFamily], [later, 'manual', 'Lora']);
    await mock.updateQuiz(quiz.id, { settings: quiz.settings, appearance: quiz.appearance }, { version: saved.version }).catch(() => {});
  } finally {
    if (before === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, before);
  }
});
