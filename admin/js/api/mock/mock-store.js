// @ts-check
/**
 * DEMO MODE ONLY — the mock backend's "database": demo quizzes kept in this
 * browser's localStorage so changes survive a reload while you try the site.
 * This is clearly labelled mock storage (the demo banner says so on every
 * page). The real backend stores everything; the admin site itself never
 * keeps quiz content in localStorage.
 */
import { createDemoQuizzes, createDemoBank, createDemoAttempts, DEMO_ASSETS } from './mock-data.js';
import { recompute, markFinals } from './mock-grading.js';

const QUIZZES_KEY = 'jci-mock:quizzes';
const SEED_KEY = 'jci-mock:seed';
/** Bump when the demo data changes, so browsers pick up the new set. */
const SEED_VERSION = '7';

/** @type {any[] | null} */
let quizzes = null;

/**
 * All demo quizzes in the backend's JSON shape. Read fresh on every call, so
 * two open tabs see each other's changes, just like a real server (this is
 * what lets you try the "changed somewhere else" conflict in demo mode).
 */
export function loadQuizzes() {
  try {
    if (window.localStorage.getItem(SEED_KEY) === SEED_VERSION) {
      const parsed = JSON.parse(window.localStorage.getItem(QUIZZES_KEY) || 'null');
      if (Array.isArray(parsed)) {
        quizzes = parsed;
        return quizzes;
      }
    }
  } catch {
    /* storage blocked: keep using the copy in memory */
    if (quizzes) return quizzes;
  }
  if (!quizzes) {
    quizzes = createDemoQuizzes();
    saveQuizzes();
    seedAssets();
  }
  return quizzes;
}

export function saveQuizzes() {
  try {
    window.localStorage.setItem(QUIZZES_KEY, JSON.stringify(quizzes || []));
    window.localStorage.setItem(SEED_KEY, SEED_VERSION);
  } catch {
    /* storage full or blocked: changes last until the page reloads */
  }
}

/** Put the demo quizzes back (Settings → Demo data). */
export function resetDemoData() {
  quizzes = createDemoQuizzes();
  saveQuizzes();
  bank = createDemoBank();
  saveBank();
  attempts = createDemoAttempts(quizzes, { recompute, markFinals });
  saveAttempts();
  assets = {};
  try { window.localStorage.removeItem(ASSETS_KEY); } catch { /* ignore */ }
  seedAssets();
}

/** The demo's own images, stored like uploads. */
function seedAssets() {
  for (const [assetId, url] of Object.entries(DEMO_ASSETS)) saveAsset(assetId, url);
}

// Uploaded images (demo mode): asset id -> a small, resized copy as a data URL.
const ASSETS_KEY = 'jci-mock:assets';
/** @type {Record<string, string> | null} */
let assets = null;

function loadAssets() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ASSETS_KEY) || 'null');
    if (parsed && typeof parsed === 'object') assets = parsed;
  } catch {
    /* storage blocked: keep the copy in memory */
  }
  if (!assets) assets = {};
  return assets;
}

/** @param {string} assetId */
export function assetUrl(assetId) {
  return loadAssets()[assetId] || null;
}

/** @param {string} assetId @param {string} url */
export function saveAsset(assetId, url) {
  const all = loadAssets();
  all[assetId] = url;
  try {
    window.localStorage.setItem(ASSETS_KEY, JSON.stringify(all));
  } catch {
    /* storage full: the image lasts until the page reloads */
  }
}

// Question Bank (demo mode) ----------------------------------------------------
const BANK_KEY = 'jci-mock:bank';
/** @type {any[] | null} */
let bank = null;

/** The demo bank, read fresh on every call (like the quizzes). */
export function loadBank() {
  try {
    if (window.localStorage.getItem(SEED_KEY) === SEED_VERSION) {
      const parsed = JSON.parse(window.localStorage.getItem(BANK_KEY) || 'null');
      if (Array.isArray(parsed)) {
        bank = parsed;
        return bank;
      }
    }
  } catch {
    if (bank) return bank;
  }
  if (!bank) {
    loadQuizzes();   // seed quizzes and images first, so their links line up
    bank = createDemoBank();
    saveBank();
  }
  return bank;
}

export function saveBank() {
  try {
    window.localStorage.setItem(BANK_KEY, JSON.stringify(bank || []));
  } catch {
    /* storage full or blocked: changes last until the page reloads */
  }
}

// Attempts (demo mode, Stage 9) -------------------------------------------------
const ATTEMPTS_KEY = 'jci-mock:attempts';
/** @type {any[] | null} */
let attempts = null;

/** Demo participants' attempts, read fresh on every call. */
export function loadAttempts() {
  try {
    if (window.localStorage.getItem(SEED_KEY) === SEED_VERSION) {
      const parsed = JSON.parse(window.localStorage.getItem(ATTEMPTS_KEY) || 'null');
      if (Array.isArray(parsed)) {
        attempts = parsed;
        return attempts;
      }
    }
  } catch {
    if (attempts) return attempts;
  }
  if (!attempts) {
    attempts = createDemoAttempts(loadQuizzes(), { recompute, markFinals });
    saveAttempts();
  }
  return attempts;
}

export function saveAttempts() {
  try {
    window.localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts || []));
  } catch {
    /* storage full or blocked: changes last until the page reloads */
  }
}
