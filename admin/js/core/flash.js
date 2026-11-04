// @ts-check
/**
 * A one-time message carried to the next page (e.g. "Draft created" after
 * New quiz opens the editor). Kept in sessionStorage for a single page load,
 * and it only ever holds a short UI message, never quiz content.
 */

const KEY = 'jci-admin-flash';

/**
 * @typedef {Object} Flash
 * @property {string} message
 * @property {'success' | 'error' | 'info'} type
 * @property {string[]} [notes]   a few short lines for the next page (e.g. what a copy left out)
 */

/** @param {Flash} flash */
export function setFlash(flash) {
  try {
    const notes = (flash.notes || []).slice(0, 12).map((note) => String(note).slice(0, 300));
    window.sessionStorage.setItem(KEY, JSON.stringify({ message: String(flash.message), type: flash.type, notes }));
  } catch {
    /* storage blocked: the next page just won't show the message */
  }
}

/** Read and remove the waiting message, if any. @returns {Flash | null} */
export function takeFlash() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.message !== 'string') return null;
    const notes = Array.isArray(value.notes) ? value.notes.filter((note) => typeof note === 'string').slice(0, 12) : [];
    return { message: value.message, type: ['success', 'error', 'info'].includes(value.type) ? value.type : 'info', notes };
  } catch {
    return null;
  }
}
