// @ts-check
/**
 * Quiz appearance (sections 17 and 18): the fonts, sizes and presets an admin
 * can choose, the inheritance rule (quiz defaults + a question's overrides),
 * and the readability (contrast) maths.
 *
 * SHAREABLE: this file has no dependencies, so the participant-section developer can use
 * the exact same rules (with renderer.js and css/quiz-render.css) and quizzes
 * look identical in both sites.
 *
 * The admin site's own Dark Mode / Light Mode never touches any of this: a
 * quiz's appearance is the quiz's data, not the admin's theme.
 */

/**
 * @typedef {Object} Appearance
 * @property {string} fontFamily      one of FONT_FAMILIES
 * @property {number} fontSize        one of FONT_SIZES (question text, px)
 * @property {string} textColor       "#RRGGBB"
 * @property {string} pageBackground  "#RRGGBB"
 * @property {string} cardBackground  "#RRGGBB"
 * @property {boolean} bold
 * @property {boolean} italic
 * @property {boolean} underline
 * @property {'left' | 'center'} align
 */

/** The curated fonts (section 17). `google` is the Google Fonts family spec. */
export const FONT_FAMILIES = Object.freeze([
  { id: 'Inter', kind: 'Sans serif', stack: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', google: 'Inter:ital,wght@0,400;0,600;0,700;1,400;1,700' },
  { id: 'Poppins', kind: 'Sans serif', stack: '"Poppins", system-ui, -apple-system, "Segoe UI", Arial, sans-serif', google: 'Poppins:ital,wght@0,400;0,600;0,700;1,400;1,700' },
  { id: 'Nunito', kind: 'Rounded', stack: '"Nunito", system-ui, -apple-system, "Segoe UI", Arial, sans-serif', google: 'Nunito:ital,wght@0,400;0,600;0,700;1,400;1,700' },
  { id: 'Lora', kind: 'Serif', stack: '"Lora", Georgia, "Times New Roman", serif', google: 'Lora:ital,wght@0,400;0,600;0,700;1,400;1,700' },
  { id: 'Merriweather', kind: 'Serif', stack: '"Merriweather", Georgia, "Times New Roman", serif', google: 'Merriweather:ital,wght@0,400;0,700;1,400;1,700' },
  { id: 'Roboto Slab', kind: 'Slab serif', stack: '"Roboto Slab", Rockwell, Georgia, serif', google: 'Roboto+Slab:wght@400;600;700' }
]);

/** Question text sizes in px. Answer options use optionFontSize(). */
export const FONT_SIZES = Object.freeze([14, 16, 18, 20, 24, 28]);

/** One-click starting points; everything stays editable afterwards. */
export const PRESETS = Object.freeze([
  { id: 'jci-classic', name: 'JCI Classic', pageBackground: '#EEF6FB', cardBackground: '#FFFFFF', textColor: '#130F2D' },
  { id: 'jci-bold', name: 'JCI Bold', pageBackground: '#130F2D', cardBackground: '#FFFFFF', textColor: '#130F2D' },
  { id: 'ocean', name: 'Ocean', pageBackground: '#0097D7', cardBackground: '#FFFFFF', textColor: '#130F2D' },
  { id: 'night', name: 'Night', pageBackground: '#0B0A14', cardBackground: '#17152A', textColor: '#F5F6FA' },
  { id: 'paper', name: 'Paper', pageBackground: '#F7F3EA', cardBackground: '#FFFDF8', textColor: '#2B2A28' },
  { id: 'high-contrast', name: 'High contrast', pageBackground: '#FFFFFF', cardBackground: '#FFFFFF', textColor: '#000000' }
]);

/** New quizzes start with JCI Classic. */
export const DEFAULT_APPEARANCE = Object.freeze(/** @type {Appearance} */ ({
  fontFamily: 'Inter',
  fontSize: 18,
  textColor: '#130F2D',
  pageBackground: '#EEF6FB',
  cardBackground: '#FFFFFF',
  bold: false,
  italic: false,
  underline: false,
  align: 'left'
}));

/** What a single question may override (the page background is quiz-wide only). */
export const QUESTION_OVERRIDE_KEYS = Object.freeze(['fontFamily', 'fontSize', 'textColor', 'cardBackground', 'bold', 'italic', 'underline', 'align']);

const APPEARANCE_KEYS = Object.freeze(['fontFamily', 'fontSize', 'textColor', 'pageBackground', 'cardBackground', 'bold', 'italic', 'underline', 'align']);
const COLOR_KEYS = new Set(['textColor', 'pageBackground', 'cardBackground']);
const BOOLEAN_KEYS = new Set(['bold', 'italic', 'underline']);

/**
 * "#abc", "abc", "#AABBCC" or "aabbcc" -> "#AABBCC". Anything else -> null.
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeHex(value) {
  const text = String(value ?? '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(text)) return `#${text.split('').map((c) => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text}`.toUpperCase();
  return null;
}

/**
 * Check one appearance value. Returns the clean value, or undefined if invalid.
 * @param {string} key
 * @param {unknown} value
 */
function cleanValue(key, value) {
  if (key === 'fontFamily') return FONT_FAMILIES.some((f) => f.id === value) ? String(value) : undefined;
  if (key === 'fontSize') return FONT_SIZES.includes(Number(value)) ? Number(value) : undefined;
  if (COLOR_KEYS.has(key)) return normalizeHex(value) ?? undefined;
  if (BOOLEAN_KEYS.has(key)) return typeof value === 'boolean' ? value : undefined;
  if (key === 'align') return value === 'left' || value === 'center' ? value : undefined;
  return undefined;
}

/**
 * A complete, valid quiz appearance: unknown fonts, sizes or colours fall
 * back to the defaults, so a bad value can never break the page.
 * @param {unknown} raw
 * @returns {Appearance}
 */
export function sanitizeAppearance(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of APPEARANCE_KEYS) {
    const value = cleanValue(key, source[key]);
    out[key] = value === undefined ? /** @type {Record<string, unknown>} */ (DEFAULT_APPEARANCE)[key] : value;
  }
  return /** @type {Appearance} */ (out);
}

/**
 * A question's overrides: only known, valid properties are kept.
 * An empty object means "inherit everything from the quiz".
 * @param {unknown} raw
 * @returns {Partial<Appearance>}
 */
export function sanitizeOverrides(raw) {
  const source = raw && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of QUESTION_OVERRIDE_KEYS) {
    if (!(key in source)) continue;
    const value = cleanValue(key, source[key]);
    if (value !== undefined) out[key] = value;
  }
  return /** @type {Partial<Appearance>} */ (out);
}

/**
 * THE inheritance rule: the quiz's appearance with the question's overrides
 * on top. Used by the editor canvas, Preview and (ideally) the participant site.
 * @param {Partial<Appearance> | null | undefined} quizAppearance
 * @param {Partial<Appearance> | null | undefined} [overrides]
 * @returns {Appearance}
 */
export function resolveAppearance(quizAppearance, overrides) {
  return { ...sanitizeAppearance(quizAppearance), ...sanitizeOverrides(overrides) };
}

/** True when a question overrides anything. @param {unknown} overrides */
export function hasOverrides(overrides) {
  return Object.keys(sanitizeOverrides(overrides)).length > 0;
}

/**
 * Answer options use the same font, a little smaller than the question:
 * 85% of the question size, never below 14px (14→14, 18→15, 24→20, 28→24).
 * @param {number} questionSize
 */
export function optionFontSize(questionSize) {
  return Math.max(14, Math.round(questionSize * 0.85));
}

/** @param {string} family */
export function fontStack(family) {
  return (FONT_FAMILIES.find((f) => f.id === family) || FONT_FAMILIES[0]).stack;
}

/**
 * CSS custom properties for one card (or the page), read by css/quiz-render.css.
 * @param {Appearance} a
 * @returns {Record<string, string>}
 */
export function appearanceVars(a) {
  return {
    '--qr-font': fontStack(a.fontFamily),
    '--qr-size': `${a.fontSize}px`,
    '--qr-option-size': `${optionFontSize(a.fontSize)}px`,
    '--qr-text': a.textColor,
    '--qr-page-bg': a.pageBackground,
    '--qr-card-bg': a.cardBackground,
    '--qr-weight': a.bold ? '700' : '600',
    '--qr-style': a.italic ? 'italic' : 'normal',
    '--qr-decoration': a.underline ? 'underline' : 'none',
    '--qr-align': a.align
  };
}

/**
 * The preset this appearance matches exactly (colours only), or null.
 * @param {Pick<Appearance, 'pageBackground' | 'cardBackground' | 'textColor'>} a
 */
export function matchPreset(a) {
  const page = normalizeHex(a.pageBackground);
  const card = normalizeHex(a.cardBackground);
  const text = normalizeHex(a.textColor);
  return PRESETS.find((p) => p.pageBackground === page && p.cardBackground === card && p.textColor === text) || null;
}

/**
 * Apply a preset's colours; fonts and formatting are kept.
 * @param {Appearance} a
 * @param {string} presetId
 * @returns {Appearance}
 */
export function applyPreset(a, presetId) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return a;
  return { ...a, pageBackground: preset.pageBackground, cardBackground: preset.cardBackground, textColor: preset.textColor };
}

// Readability (WCAG 2.x contrast) -----------------------------------------------------

/** @param {string} hex @returns {[number, number, number]} 0–255 */
function rgb(hex) {
  const h = normalizeHex(hex) || '#000000';
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/** Relative luminance (WCAG). @param {string} hex */
export function luminance(hex) {
  const [r, g, b] = rgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, from 1 to 21.
 * @param {string} a
 * @param {string} b
 */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The minimum contrast the text needs: 3:1 for large text (24px and up, or
 * 19px and up when bold), otherwise 4.5:1.
 * @param {{ fontSize: number, bold: boolean }} a
 */
export function requiredContrast({ fontSize, bold }) {
  return fontSize >= 24 || (bold && fontSize >= 19) ? 3 : 4.5;
}

/** "2.1:1", rounded down so a failing ratio never reads as passing. @param {number} ratio */
export function formatRatio(ratio) {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

/**
 * Is this text readable on its card?
 * @param {Appearance} a   an effective (resolved) appearance
 * @returns {{ ratio: number, required: number, ok: boolean, message: string }}
 */
export function contrastCheck(a) {
  const ratio = contrastRatio(a.textColor, a.cardBackground);
  const required = requiredContrast(a);
  const ok = ratio >= required;
  return {
    ratio,
    required,
    ok,
    message: ok
      ? `Easy to read: contrast ${formatRatio(ratio)}`
      : `Hard to read: contrast ${formatRatio(ratio)} (aim for ${required}:1)`
  };
}

/** @param {string} hex @returns {[number, number, number]} h 0–360, s and l 0–100 */
function toHsl(hex) {
  const [r, g, b] = rgb(hex).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s * 100, l * 100];
}

/** @param {number} h @param {number} s @param {number} l */
function fromHsl(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (/** @type {number} */ n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (/** @type {number} */ n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * A readable version of the text colour: the same hue, made darker (on light
 * cards) or lighter (on dark cards) just until it passes. Only a suggestion —
 * the admin decides whether to use it.
 * @param {string} text
 * @param {string} background
 * @param {number} [required]
 */
export function suggestReadableColor(text, background, required = 4.5) {
  const current = normalizeHex(text) || '#000000';
  if (contrastRatio(current, background) >= required) return current;
  const darker = contrastRatio('#000000', background) >= contrastRatio('#FFFFFF', background);
  const [h, s, l] = toHsl(current);
  for (let step = 1; step <= 100; step += 1) {
    const next = darker ? l - step : l + step;
    if (next < 0 || next > 100) break;
    const candidate = fromHsl(h, s, next);
    if (contrastRatio(candidate, background) >= required + 0.05) return candidate;
  }
  return darker ? '#000000' : '#FFFFFF';
}

// Fonts ------------------------------------------------------------------------------

/** @type {Set<string>} */
const loadedFonts = new Set(['Inter']);

/**
 * Load quiz fonts from Google Fonts, once each. Inter is already on every
 * admin page. The URL is built only from the fixed list above.
 * @param {string[]} families
 */
export function loadFonts(families) {
  if (typeof document === 'undefined') return;
  const wanted = FONT_FAMILIES.filter((f) => families.includes(f.id) && !loadedFonts.has(f.id));
  if (!wanted.length) return;
  wanted.forEach((f) => loadedFonts.add(f.id));
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${wanted.map((f) => `family=${f.google}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}
