// @ts-check
/**
 * The two appearance panels (section 17):
 * - Quiz appearance (Details tab): presets, font, size, formatting, colours,
 *   a live sample card and a readability check. These are the quiz's
 *   defaults.
 * - A question's appearance (in the builder): each property shows whether it
 *   follows the quiz ("Quiz default") or is set for this question ("Custom"),
 *   with its own reset and a "Reset all to quiz defaults".
 * Both warn about low contrast and can suggest a readable colour, but never
 * change the admin's choices on their own.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { toast } from '../components/toast.js';
import { createColorPicker } from '../components/color-picker.js';
import { createFontSelect } from '../components/font-select.js';
import {
  PRESETS, FONT_SIZES, DEFAULT_APPEARANCE, QUESTION_OVERRIDE_KEYS,
  sanitizeAppearance, sanitizeOverrides, resolveAppearance, applyPreset, matchPreset, appearanceVars,
  contrastCheck, suggestReadableColor, loadFonts
} from './appearance.js';
import { renderQuestion, SAMPLE_QUESTION } from './renderer.js';

/** @typedef {import('./appearance.js').Appearance} Appearance */
/** @typedef {import('./renderer.js').RenderQuestion} RenderQuestion */

const FORMAT_LABELS = /** @type {const} */ ({ bold: 'Bold', italic: 'Italic', underline: 'Underline' });

/**
 * A line saying whether the text is easy to read, with a suggestion button
 * when it isn't.
 * @param {Appearance} effective
 * @param {(color: string) => void} onSuggest
 * @param {boolean} [disabled]
 */
export function contrastNote(effective, onSuggest, disabled = false) {
  const check = contrastCheck(effective);
  if (check.ok) {
    return el('p', { class: 'contrast-note is-ok' }, icon('checkCircle', { size: 16 }), el('span', { text: check.message }));
  }
  const suggestion = suggestReadableColor(effective.textColor, effective.cardBackground, check.required);
  return el('div', { class: 'contrast-note is-low', attrs: { role: 'status' } },
    icon('alertTriangle', { size: 16 }),
    el('span', { class: 'contrast-note__text', text: check.message }),
    disabled ? null : el('button', {
      type: 'button',
      class: 'btn btn--small contrast-note__suggest',
      on: { click: () => onSuggest(suggestion) }
    }, el('span', { class: 'contrast-note__swatch', attrs: { 'aria-hidden': 'true' }, style: `background:${suggestion}` }),
    el('span', { class: 'btn__label', text: 'Suggest a readable color' }),
    el('span', { class: 'sr-only', text: `: ${suggestion}` })));
}

/**
 * A small radio group (sizes, alignment).
 * @param {string} name
 * @param {string} legend
 * @param {[string, string][]} choices
 * @param {string} value
 * @param {(value: string) => void} onPick
 */
function miniChoice(name, legend, choices, value, onPick) {
  const inputs = choices.map(([v, label]) => {
    const input = el('input', { type: 'radio', name, value: v, checked: v === value });
    input.addEventListener('change', () => { if (input.checked) onPick(v); });
    return el('label', { class: 'mini-segmented__option' }, input, el('span', { text: label }));
  });
  return el('fieldset', { class: 'mini-segmented' },
    el('legend', { class: 'field__label', text: legend }),
    el('div', { class: 'mini-segmented__options' }, inputs));
}

/** @param {HTMLElement} root @param {string} name @param {string} value */
function checkRadio(root, name, value) {
  const input = /** @type {HTMLInputElement | null} */ (root.querySelector(`input[name="${name}"][value="${CSS.escape(value)}"]`));
  if (input) input.checked = true;
}

/** A mini picture of a preset: page colour, a card, and text lines. @param {(typeof PRESETS)[number]} preset */
function presetThumb(preset) {
  const thumb = el('span', { class: 'preset__thumb', attrs: { 'aria-hidden': 'true' } },
    el('span', { class: 'preset__card' }, el('span', { class: 'preset__line' }), el('span', { class: 'preset__line preset__line--short' })));
  thumb.style.background = preset.pageBackground;
  const card = /** @type {HTMLElement} */ (thumb.firstElementChild);
  card.style.background = preset.cardBackground;
  card.style.color = preset.textColor;
  return thumb;
}

/**
 * Quiz-wide appearance, in the Details tab.
 * @param {HTMLElement} host
 * @param {{
 *   appearance: Partial<Appearance>,
 *   sample: () => RenderQuestion | null,
 *   readOnly?: boolean,
 *   note?: string,
 *   onChange: (appearance: Appearance) => void
 * }} options
 */
export function createQuizAppearancePanel(host, options) {
  const { sample, onChange } = options;
  let current = sanitizeAppearance(options.appearance);
  let readOnly = Boolean(options.readOnly);

  const noteEl = el('p', { class: 'appearance-panel__lock', hidden: true });
  const presetButtons = PRESETS.map((preset) => el('button', {
    type: 'button',
    class: 'preset',
    data: { preset: preset.id },
    attrs: { 'aria-pressed': 'false' },
    on: {
      click: () => {
        commit(applyPreset(current, preset.id));
        announce(`${preset.name} colours applied. You can still change each one.`);
      }
    }
  }, presetThumb(preset), el('span', { class: 'preset__name', text: preset.name })));

  const font = createFontSelect({ id: 'appearance-font', value: current.fontFamily, onChange: (family) => commit({ ...current, fontFamily: family }) });
  const size = miniChoice('appearance-size', 'Question text size', FONT_SIZES.map((s) => [String(s), `${s}`]), String(current.fontSize),
    (v) => commit({ ...current, fontSize: Number(v) }));
  const formatButtons = /** @type {(keyof typeof FORMAT_LABELS)[]} */ (['bold', 'italic', 'underline']).map((key) => el('button', {
    type: 'button',
    class: ['format-toggle', `format-toggle--${key}`],
    data: { format: key },
    attrs: { 'aria-pressed': String(current[key]), 'aria-label': FORMAT_LABELS[key], title: FORMAT_LABELS[key] },
    on: { click: () => commit({ ...current, [key]: !current[key] }) }
  }, el('span', { attrs: { 'aria-hidden': 'true' }, text: FORMAT_LABELS[key][0] })));
  const align = miniChoice('appearance-align', 'Alignment', [['left', 'Left'], ['center', 'Center']], current.align,
    (v) => commit({ ...current, align: /** @type {'left' | 'center'} */ (v) }));

  /** @param {'textColor' | 'pageBackground' | 'cardBackground'} key @param {string} label @param {string} hint */
  const colorField = (key, label, hint) => {
    const id = `appearance-${key}`;
    const picker = createColorPicker({ id, label, value: current[key], onChange: (hex) => commit({ ...current, [key]: hex }, { quiet: true }), describedBy: `${id}-hint` });
    const field = el('div', { class: 'field' },
      el('label', { class: 'field__label', for: id, text: label }),
      picker.element,
      el('p', { class: 'field__hint', id: `${id}-hint`, text: hint }));
    return { picker, field };
  };
  const colors = {
    textColor: colorField('textColor', 'Question text color', 'Questions and answers.'),
    cardBackground: colorField('cardBackground', 'Question card background', 'Each question sits on a card of this colour.'),
    pageBackground: colorField('pageBackground', 'Quiz page background', 'Behind the cards, across the whole page.')
  };

  const contrastHost = el('div', { class: 'appearance-panel__contrast', attrs: { 'aria-live': 'polite' } });
  const reset = el('button', { type: 'button', class: 'btn btn--small btn--ghost', on: { click: resetToDefault } },
    icon('restore', { size: 16 }), el('span', { class: 'btn__label', text: 'Reset to default appearance' }));

  const samplePage = el('div', { class: 'appearance-sample__page' });
  const sampleBox = el('div', { class: 'appearance-sample' },
    el('p', { class: 'appearance-sample__label' }, icon('eye', { size: 16 }), el('span', { text: 'Live sample · what participants see' })),
    samplePage);

  const controls = el('div', { class: 'appearance-panel__controls' },
    el('fieldset', { class: 'appearance-panel__group' },
      el('legend', { class: 'field__label', text: 'Presets' }),
      el('div', { class: 'presets' }, presetButtons),
      el('p', { class: 'field__hint', text: 'A starting point. Every colour stays editable afterwards.' })),
    el('div', { class: 'appearance-panel__row' },
      el('div', { class: 'field' }, el('label', { class: 'field__label', for: 'appearance-font', text: 'Font' }), font.element),
      size),
    el('div', { class: 'appearance-panel__row' },
      el('div', { class: 'field' },
        el('span', { class: 'field__label', id: 'appearance-format-label', text: 'Question text style' }),
        el('div', { class: 'format-toggles', attrs: { role: 'group', 'aria-labelledby': 'appearance-format-label' } }, formatButtons)),
      align),
    el('div', { class: 'appearance-panel__colors' }, colors.textColor.field, colors.cardBackground.field, colors.pageBackground.field),
    contrastHost,
    el('div', { class: 'appearance-panel__footer' }, reset));

  host.replaceChildren(
    el('div', { class: 'appearance-panel__head' },
      el('h2', { class: 'card-title', id: 'appearance-heading', text: 'Quiz appearance' }),
      el('p', { class: 'card__description', text: 'These colors and fonts are what participants see. They are separate from your Dark Mode / Light Mode setting.' }),
      noteEl),
    el('div', { class: 'appearance-panel__layout' }, sampleBox, controls));

  /** @param {Appearance} next @param {{ quiet?: boolean }} [how] */
  function commit(next, { quiet = false } = {}) {
    if (readOnly) return;
    current = sanitizeAppearance(next);
    sync({ fromPicker: quiet });
    onChange(current);
  }

  function resetToDefault() {
    const before = current;
    if (JSON.stringify(before) === JSON.stringify(sanitizeAppearance(DEFAULT_APPEARANCE))) {
      toast({ message: 'This quiz already uses the default appearance.' });
      return;
    }
    commit({ ...DEFAULT_APPEARANCE });
    toast({
      message: 'Appearance reset to JCI Classic.',
      duration: 6000,
      action: { label: 'Undo', onClick: () => { commit(before); announce('Appearance restored.'); } }
    });
  }

  /** Bring every control and the sample in line with `current`. @param {{ fromPicker?: boolean }} [how] */
  function sync({ fromPicker = false } = {}) {
    const preset = matchPreset(current);
    presetButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.preset === preset?.id)));
    font.set(current.fontFamily);
    checkRadio(size, 'appearance-size', String(current.fontSize));
    checkRadio(align, 'appearance-align', current.align);
    formatButtons.forEach((button) => {
      const key = /** @type {'bold' | 'italic' | 'underline'} */ (button.dataset.format);
      button.setAttribute('aria-pressed', String(current[key]));
    });
    if (!fromPicker) for (const [key, { picker }] of Object.entries(colors)) picker.set(/** @type {any} */ (current)[key]);
    paintSample();
    contrastHost.replaceChildren(contrastNote(current, (color) => {
      commit({ ...current, textColor: color });
      colors.textColor.picker.set(color);
      announce(`Text color changed to ${color}.`);
    }, readOnly));
  }

  /** Update the sample's colours in place, so they change smoothly. */
  function paintSample() {
    samplePage.style.background = current.pageBackground;
    const card = /** @type {HTMLElement | null} */ (samplePage.querySelector('.qr-card'));
    if (!card) return;
    for (const [name, value] of Object.entries(appearanceVars(current))) card.style.setProperty(name, value);
  }

  function renderSample() {
    const question = sample() || SAMPLE_QUESTION;
    loadFonts([current.fontFamily]);
    samplePage.replaceChildren(renderQuestion({ ...question, appearance: {} }, current, { number: 1, showCorrect: false }));
    paintSample();
  }

  /** @param {boolean} on @param {string} [note] */
  function setReadOnly(on, note = '') {
    readOnly = on;
    noteEl.hidden = !note;
    noteEl.replaceChildren(...(note ? [icon(on ? 'archive' : 'info', { size: 16 }), el('span', { text: note })] : []));
    host.classList.toggle('is-readonly', on);
    presetButtons.forEach((b) => { b.disabled = on; });
    formatButtons.forEach((b) => { b.disabled = on; });
    font.setDisabled(on);
    reset.disabled = on;
    [size, align].forEach((group) => group.querySelectorAll('input').forEach((i) => { i.disabled = on; }));
    Object.values(colors).forEach(({ picker }) => picker.setDisabled(on));
    sync();
  }

  renderSample();
  setReadOnly(readOnly, options.note);

  return {
    /** Replace the appearance (e.g. after loading the latest version). @param {Partial<Appearance>} next */
    set(next) {
      current = sanitizeAppearance(next);
      renderSample();
      sync();
    },
    setReadOnly,
    /** The first question changed: redraw the sample. */
    refreshSample: renderSample,
    get value() { return current; }
  };
}

/**
 * One question's appearance overrides, inside its card in the builder.
 * @param {{
 *   id: string,
 *   question: () => RenderQuestion & { appearance: Partial<Appearance> },
 *   quizAppearance: () => Appearance,
 *   onChange: (overrides: Partial<Appearance>) => void
 * }} options
 */
export function createQuestionAppearance({ id, question, quizAppearance, onChange }) {
  const overrides = () => sanitizeOverrides(question().appearance);
  const effective = () => resolveAppearance(quizAppearance(), question().appearance);

  /** @param {string} key @param {unknown} value */
  const setOverride = (key, value) => onChange({ ...overrides(), [key]: value });
  /** @param {string} key */
  const clearOverride = (key) => {
    const next = /** @type {Record<string, unknown>} */ ({ ...overrides() });
    delete next[key];
    onChange(/** @type {Partial<Appearance>} */ (next));
  };

  const font = createFontSelect({ id: `${id}-fontFamily`, value: effective().fontFamily, onChange: (family) => setOverride('fontFamily', family) });
  const sizeSelect = el('select', { class: 'select', id: `${id}-fontSize` },
    FONT_SIZES.map((s) => el('option', { value: String(s), text: `${s} px` })));
  sizeSelect.addEventListener('change', () => setOverride('fontSize', Number(sizeSelect.value)));
  const alignSelect = el('select', { class: 'select', id: `${id}-align` },
    el('option', { value: 'left', text: 'Left' }), el('option', { value: 'center', text: 'Center' }));
  alignSelect.addEventListener('change', () => setOverride('align', alignSelect.value));
  const textColor = createColorPicker({ id: `${id}-textColor`, label: 'Text color', value: effective().textColor, onChange: (hex) => setOverride('textColor', hex) });
  const cardColor = createColorPicker({ id: `${id}-cardBackground`, label: 'Card background', value: effective().cardBackground, onChange: (hex) => setOverride('cardBackground', hex) });
  /** @type {Record<string, HTMLInputElement>} */
  const switches = {};
  for (const key of ['bold', 'italic', 'underline']) {
    const input = el('input', { type: 'checkbox', class: 'switch__input', id: `${id}-${key}`, attrs: { role: 'switch' } });
    input.addEventListener('change', () => setOverride(key, input.checked));
    switches[key] = input;
  }
  /** @param {string} key */
  const switchControl = (key) => el('label', { class: 'switch switch--compact', for: `${id}-${key}` },
    switches[key], el('span', { class: 'switch__track', attrs: { 'aria-hidden': 'true' } }, el('span', { class: 'switch__thumb' })),
    el('span', { class: 'sr-only', text: /** @type {Record<string, string>} */ (FORMAT_LABELS)[key] }));

  /** @type {[string, string, HTMLElement][]} key, label, control */
  const rows = [
    ['fontFamily', 'Font', font.element],
    ['fontSize', 'Text size', sizeSelect],
    ['textColor', 'Text color', textColor.element],
    ['cardBackground', 'Card background', cardColor.element],
    ['bold', 'Bold', switchControl('bold')],
    ['italic', 'Italic', switchControl('italic')],
    ['underline', 'Underline', switchControl('underline')],
    ['align', 'Alignment', alignSelect]
  ];
  const rowEls = rows.map(([key, label, control]) => {
    const controlId = `${id}-${key}`;
    const state = el('span', { class: 'qa-row__state', data: { stateFor: key } });
    const resetButton = el('button', {
      type: 'button',
      class: 'btn btn--ghost btn--icon qa-row__reset',
      data: { resetFor: key },
      attrs: { 'aria-label': `Use the quiz default for ${label.toLowerCase()}`, title: 'Use the quiz default' },
      on: {
        click: () => {
          clearOverride(key);
          announce(`${label} now follows the quiz default.`);
          /** @type {HTMLElement | null} */ (panel.querySelector(`#${CSS.escape(controlId)}`))?.focus();
        }
      }
    }, icon('restore', { size: 16 }));
    return el('div', { class: 'qa-row', data: { key } },
      el('label', { class: 'qa-row__label', for: controlId, text: label }),
      el('div', { class: 'qa-row__control' }, control),
      el('div', { class: 'qa-row__status' }, state, resetButton));
  });

  const contrastHost = el('div', { attrs: { 'aria-live': 'polite' } });
  const resetAll = el('button', {
    type: 'button',
    class: 'btn btn--small btn--ghost',
    on: {
      click: () => {
        onChange({});
        announce('This question now follows the quiz appearance.');
      }
    }
  }, icon('restore', { size: 16 }), el('span', { class: 'btn__label', text: 'Reset all to quiz defaults' }));
  const previewPage = el('div', { class: 'appearance-sample__page' });

  const panel = el('div', { class: 'qa-panel', id: `${id}-panel` },
    el('div', { class: 'qa-panel__head' },
      el('p', { class: 'qa-panel__title', text: 'Appearance for this question' }),
      el('p', { class: 'field__hint', text: 'Anything you don’t change follows the quiz appearance (Details tab). Image placement and size are set with the image.' })),
    el('div', { class: 'qa-panel__layout' },
      el('div', { class: 'qa-panel__rows' }, rowEls, contrastHost, el('div', { class: 'qa-panel__footer' }, resetAll)),
      el('div', { class: 'appearance-sample' },
        el('p', { class: 'appearance-sample__label' }, icon('eye', { size: 16 }), el('span', { text: 'What participants see' })),
        previewPage)));

  function refresh() {
    const own = overrides();
    const look = effective();
    font.set(look.fontFamily);
    sizeSelect.value = String(look.fontSize);
    alignSelect.value = look.align;
    textColor.set(look.textColor);
    cardColor.set(look.cardBackground);
    for (const key of ['bold', 'italic', 'underline']) switches[key].checked = Boolean(/** @type {any} */ (look)[key]);
    for (const key of QUESTION_OVERRIDE_KEYS) {
      const custom = key in own;
      const row = /** @type {HTMLElement} */ (panel.querySelector(`.qa-row[data-key="${key}"]`));
      row.classList.toggle('is-custom', custom);
      const state = /** @type {HTMLElement} */ (row.querySelector('.qa-row__state'));
      state.textContent = custom ? 'Custom' : 'Quiz default';
      /** @type {HTMLButtonElement} */ (row.querySelector('.qa-row__reset')).hidden = !custom;
    }
    resetAll.disabled = Object.keys(own).length === 0;
    contrastHost.replaceChildren(contrastNote(look, (color) => {
      setOverride('textColor', color);
      announce(`Text color for this question changed to ${color}.`);
    }));
    loadFonts([look.fontFamily]);
    previewPage.style.background = quizAppearance().pageBackground;
    previewPage.replaceChildren(renderQuestion(question(), quizAppearance(), { showCorrect: true }));
  }

  refresh();
  return { element: panel, refresh };
}
