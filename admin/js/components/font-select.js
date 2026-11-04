// @ts-check
/**
 * Font family picker: the six curated quiz fonts (section 17), each with its
 * style in words, and a live "Aa" sample in the chosen font. The font file
 * is loaded from Google Fonts the first time it's picked.
 */
import { el } from '../core/dom.js';
import { FONT_FAMILIES, fontStack, loadFonts } from '../quiz/appearance.js';

/**
 * @param {{ id: string, value: string, onChange: (family: string) => void, disabled?: boolean, describedBy?: string }} options
 */
export function createFontSelect({ id, value, onChange, disabled = false, describedBy }) {
  const select = el('select', { class: 'select font-select__select', id, disabled, attrs: { 'aria-describedby': describedBy || null } },
    FONT_FAMILIES.map((font) => el('option', { value: font.id, text: font.id, title: font.kind, selected: font.id === value })));
  const sample = el('span', { class: 'font-select__sample', attrs: { 'aria-hidden': 'true' }, text: 'Aa' });
  const show = (/** @type {string} */ family) => {
    loadFonts([family]);
    sample.style.fontFamily = fontStack(family);
  };
  select.addEventListener('change', () => {
    show(select.value);
    onChange(select.value);
  });
  show(value);
  return {
    element: el('div', { class: 'font-select' }, select, sample),
    select,
    /** @param {string} family */
    set(family) {
      select.value = family;
      show(family);
    },
    /** @param {boolean} on */
    setDisabled(on) { select.disabled = on; }
  };
}
