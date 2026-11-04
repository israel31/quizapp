// @ts-check
/**
 * Simple tags (section 16): type a tag and press Enter (or a comma) to add
 * it; existing tags are suggested as you type; Backspace in the empty field
 * removes the last one. Plain text only, up to 10 tags of 30 characters.
 */
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { announce } from '../core/a11y.js';
import { cleanTags, BANK_TAG_LIMITS } from '../api/adapters.js';

let counter = 0;

/**
 * @param {{
 *   id: string,
 *   tags: string[],
 *   suggestions?: string[],
 *   onChange: (tags: string[]) => void,
 *   disabled?: boolean,
 *   describedBy?: string
 * }} options
 */
export function createTagInput({ id, tags, suggestions = [], onChange, disabled = false, describedBy }) {
  let current = cleanTags(tags);
  let known = suggestions.slice();
  let off = disabled;
  const listId = `tag-suggestions-${++counter}`;

  const datalist = el('datalist', { id: listId });
  const input = el('input', {
    class: 'input tag-input__field',
    id,
    type: 'text',
    maxLength: BANK_TAG_LIMITS.length,
    disabled,
    attrs: { list: listId, autocomplete: 'off', placeholder: 'Add a tag, then press Enter', 'aria-describedby': describedBy || null }
  });
  const chips = el('ul', { class: 'chips tag-input__chips', attrs: { 'aria-label': 'Tags' } });
  const root = el('div', { class: 'tag-input' }, chips, el('div', { class: 'tag-input__add' }, input, datalist));

  /** @param {string[]} next @param {string} [message] */
  function commit(next, message) {
    current = cleanTags(next);
    render();
    onChange(current.slice());
    if (message) announce(message);
  }

  function add() {
    const value = input.value.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    if (!value) return;
    if (current.length >= BANK_TAG_LIMITS.count) {
      announce(`Up to ${BANK_TAG_LIMITS.count} tags.`);
      return;
    }
    // Reuse an existing tag's spelling when it matches apart from capitals.
    const match = known.find((tag) => tag.toLocaleLowerCase('en') === value.toLocaleLowerCase('en'));
    input.value = '';
    commit([...current, match || value], `Tag added: ${match || value}.`);
  }

  input.addEventListener('keydown', (event) => {
    if ((event.key === 'Enter' || event.key === ',') && !event.isComposing) {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !input.value && current.length) {
      const removed = current[current.length - 1];
      commit(current.slice(0, -1), `Tag removed: ${removed}.`);
    }
  });
  input.addEventListener('change', () => {
    // Picking a suggestion from the list adds it straight away.
    if (known.includes(input.value)) add();
  });

  function render() {
    chips.replaceChildren(...current.map((tag) => el('li', { class: 'chip chip--enter' },
      el('span', { class: 'chip__label', text: tag, attrs: { title: tag } }),
      off ? null : el('button', {
        type: 'button',
        class: 'chip__remove',
        attrs: { 'aria-label': `Remove tag: ${tag}` },
        on: { click: () => { commit(current.filter((t) => t !== tag), `Tag removed: ${tag}.`); input.focus(); } }
      }, icon('close', { size: 14 })))));
    chips.hidden = !current.length;
    datalist.replaceChildren(...known.filter((tag) => !current.includes(tag)).map((tag) => el('option', { value: tag })));
    input.disabled = off || current.length >= BANK_TAG_LIMITS.count;
    input.placeholder = current.length >= BANK_TAG_LIMITS.count ? `That’s the maximum of ${BANK_TAG_LIMITS.count} tags` : 'Add a tag, then press Enter';
  }

  render();
  return {
    element: root,
    input,
    get value() { return current.slice(); },
    /** @param {string[]} next */
    set(next) { current = cleanTags(next); render(); },
    /** @param {string[]} list */
    setSuggestions(list) { known = list.slice(); render(); },
    /** @param {boolean} on */
    setDisabled(on) { off = on; render(); }
  };
}
