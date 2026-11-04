// @ts-check
/**
 * Image controls for a question or an option (section 14E): choose or drag
 * in a JPG, PNG or WebP, check its type and size, upload it through the
 * backend with a progress bar, then set alt text (required unless the image
 * is decorative), placement and size. Replace and remove are always there.
 * Only the backend's asset id and URL are ever saved — never a local path.
 */
import { CONFIG } from '../config.js';
import { el } from '../core/dom.js';
import { icon } from '../icons.js';
import { formatNumber } from '../core/format.js';
import { isAbortError, userMessage } from '../api/client.js';

/** @typedef {import('../types.js').QuizImage} QuizImage */

/**
 * Check a file before uploading it. Returns a message, or null if it's fine.
 * @param {{ type: string, size: number }} file
 */
export function checkImageFile(file) {
  const accepted = /** @type {readonly string[]} */ (CONFIG.UPLOAD.acceptedTypes);
  if (!accepted.includes(file.type)) return 'Use a JPG, PNG or WebP image.';
  if (file.size > CONFIG.UPLOAD.maxBytes) {
    const mb = (bytes) => formatNumber(Math.round((bytes / 1048576) * 10) / 10);
    return `This image is ${mb(file.size)} MB. The limit is ${mb(CONFIG.UPLOAD.maxBytes)} MB.`;
  }
  return null;
}

/**
 * @typedef {Object} ImageFieldOptions
 * @property {string} id                      unique, for labels
 * @property {QuizImage | null} image
 * @property {string} subject                 "this question" / "option 2"
 * @property {boolean} [compact]              options: no placement/size controls
 * @property {boolean} [readOnly]
 * @property {string | null} [issue]          e.g. missing alt text, shown once touched
 * @property {(file: File, options: { onProgress: (fraction: number) => void, signal: AbortSignal }) => Promise<{ assetId: string, url: string }>} upload
 * @property {(image: QuizImage | null, change: 'upload' | 'details' | 'remove') => void} onChange
 * @property {(state: 'uploading' | 'failed' | 'idle') => void} onStatus
 */

/** @param {ImageFieldOptions} options */
export function createImageField(options) {
  const { id, subject, compact = false, readOnly = false, upload, onChange, onStatus } = options;
  let image = options.image;
  /** @type {AbortController | null} */
  let controller = null;
  /** @type {File | null} */
  let lastFile = null;
  let localUrl = '';
  let altTouched = Boolean(options.issue);

  const root = el('div', { class: ['image-field', compact ? 'image-field--compact' : ''], data: { imageField: id } });
  const fileInput = el('input', {
    type: 'file',
    class: 'sr-only',
    tabIndex: -1,
    attrs: { accept: CONFIG.UPLOAD.acceptedTypes.join(','), 'aria-hidden': 'true' }
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) start(file);
  });
  const choose = () => fileInput.click();

  /** @param {string} message */
  function showError(message) {
    onStatus('failed');
    render({ error: message });
  }

  /** @param {File} file */
  async function start(file) {
    const problem = checkImageFile(file);
    if (problem) {
      render({ error: problem, keepImage: true });
      return;
    }
    controller?.abort();
    controller = new AbortController();
    lastFile = file;
    if (localUrl) URL.revokeObjectURL(localUrl);
    localUrl = URL.createObjectURL(file);
    onStatus('uploading');
    render({ uploading: 0 });
    try {
      const uploaded = await upload(file, {
        signal: controller.signal,
        onProgress: (fraction) => setProgress(fraction)
      });
      controller = null;
      const previous = image;
      image = {
        assetId: uploaded.assetId,
        url: uploaded.url,
        alt: previous ? previous.alt : '',
        decorative: previous ? previous.decorative : false,
        ...(compact ? {} : { placement: previous?.placement || 'above', size: previous?.size || 'medium' })
      };
      onStatus('idle');
      onChange(image, 'upload');
      render({ justUploaded: true });
    } catch (error) {
      controller = null;
      if (isAbortError(error)) {
        onStatus('idle');
        render({});
        return;
      }
      showError(`The image didn’t upload. ${userMessage(error)}`);
    }
  }

  /** @param {number} fraction */
  function setProgress(fraction) {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    const bar = /** @type {HTMLElement | null} */ (root.querySelector('.image-field__bar'));
    const label = root.querySelector('.image-field__progress-label');
    if (bar) bar.style.transform = `scaleX(${pct / 100})`;
    if (label) label.textContent = `Uploading… ${pct}%`;
    const track = root.querySelector('[role="progressbar"]');
    track?.setAttribute('aria-valuenow', String(pct));
  }

  /** @param {Partial<QuizImage>} patch */
  function updateDetails(patch) {
    if (!image) return;
    image = { ...image, ...patch };
    onChange(image, 'details');
  }

  /**
   * @param {{ uploading?: number, error?: string, keepImage?: boolean, justUploaded?: boolean }} state
   */
  function render(state) {
    const children = [];
    if (state.uploading !== undefined) {
      children.push(el('div', { class: 'image-field__frame is-uploading' },
        el('img', { class: 'image-field__img', src: localUrl, alt: '' }),
        el('div', { class: 'image-field__progress' },
          el('div', { class: 'image-field__track', attrs: { role: 'progressbar', 'aria-label': `Uploading image for ${subject}`, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' } },
            el('div', { class: 'image-field__bar' })),
          el('span', { class: 'image-field__progress-label', text: 'Uploading… 0%' }),
          el('button', { type: 'button', class: 'btn btn--small', on: { click: () => controller?.abort() } }, el('span', { class: 'btn__label', text: 'Cancel' })))));
    } else if (image && (!state.error || state.keepImage)) {
      children.push(details(Boolean(state.justUploaded)));
    } else if (!readOnly) {
      children.push(dropzone());
    }
    if (state.error) {
      children.push(el('div', { class: 'image-field__error', attrs: { role: 'alert' } },
        icon('alertCircle', { size: 16 }), el('span', { text: state.error }),
        lastFile && !state.keepImage ? el('button', { type: 'button', class: 'btn btn--small', on: { click: () => lastFile && start(lastFile) } }, el('span', { class: 'btn__label', text: 'Try again' })) : null,
        el('button', { type: 'button', class: 'btn btn--small', on: { click: () => { onStatus('idle'); choose(); } } }, el('span', { class: 'btn__label', text: 'Choose another' }))));
    }
    root.replaceChildren(fileInput, ...children);
  }

  function dropzone() {
    const zone = el('button', { type: 'button', class: 'image-drop', on: { click: choose } },
      icon('image', { size: compact ? 18 : 22 }),
      el('span', { class: 'image-drop__text' },
        el('strong', { text: compact ? 'Add image' : 'Add an image' }),
        compact ? null : el('span', { text: 'or drag one here · JPG, PNG or WebP, up to 5 MB' })));
    return zone;
  }

  /** @param {boolean} fresh */
  function details(fresh) {
    const img = /** @type {QuizImage} */ (image);
    const altId = `${id}-alt`;
    const decoId = `${id}-decorative`;
    const altInput = el('input', {
      class: 'input',
      id: altId,
      type: 'text',
      value: img.alt,
      maxLength: 300,
      disabled: img.decorative,
      readOnly,
      attrs: { placeholder: 'Describe what the image shows', 'aria-describedby': `${altId}-hint`, autocomplete: 'off' }
    });
    const issueSlot = el('div', { attrs: { 'aria-live': 'polite' } });
    /** Alt text is required unless the image is decorative; say so once the field has been used. */
    const syncIssue = () => {
      const current = /** @type {QuizImage} */ (image);
      const missing = !current.decorative && !current.alt.trim();
      altInput.setAttribute('aria-invalid', String(missing && altTouched));
      issueSlot.replaceChildren(missing && altTouched
        ? el('p', { class: 'q-issue' }, icon('alertCircle', { size: 14 }), el('span', { text: 'Describe the image, or mark it as decorative.' }))
        : '');
    };
    altInput.addEventListener('input', () => { updateDetails({ alt: altInput.value }); syncIssue(); });
    altInput.addEventListener('blur', () => { altTouched = true; syncIssue(); });
    const decorative = el('input', { type: 'checkbox', id: decoId, checked: img.decorative, disabled: readOnly });
    decorative.addEventListener('change', () => {
      updateDetails({ decorative: decorative.checked });
      altInput.disabled = decorative.checked;
      syncIssue();
      if (!decorative.checked) altInput.focus();
    });

    /** @param {string} name @param {string} label @param {[string, string][]} choices @param {string} value @param {(v: string) => void} set */
    const segmented = (name, label, choices, value, set) => el('fieldset', { class: 'mini-segmented' },
      el('legend', { class: 'mini-segmented__legend', text: label }),
      el('div', { class: 'mini-segmented__options' }, choices.map(([v, text]) => {
        const input = el('input', { type: 'radio', name: `${id}-${name}`, value: v, checked: v === value, disabled: readOnly });
        input.addEventListener('change', () => { if (input.checked) set(v); });
        return el('label', { class: 'mini-segmented__option' }, input, el('span', { text }));
      })));

    queueMicrotask(syncIssue);
    return el('div', { class: ['image-field__details', fresh ? 'is-fresh' : ''] },
      el('div', { class: 'image-field__frame' },
        el('img', { class: 'image-field__img', src: img.url, alt: img.decorative ? '' : img.alt, attrs: { decoding: 'async' } })),
      el('div', { class: 'image-field__meta' },
        el('div', { class: 'field' },
          el('label', { class: 'field__label', for: altId, text: 'Alt text' }),
          altInput,
          el('p', { class: 'field__hint', id: `${altId}-hint`, text: 'Read aloud to participants who can’t see the image.' }),
          issueSlot),
        el('label', { class: 'check', for: decoId }, decorative, el('span', { text: 'Decorative image (no description needed)' })),
        compact ? null : el('div', { class: 'image-field__layout' },
          segmented('placement', 'Placement', [['above', 'Above'], ['below', 'Below'], ['beside', 'Beside']], img.placement || 'above', (v) => updateDetails({ placement: /** @type {any} */ (v) })),
          segmented('size', 'Size', [['small', 'Small'], ['medium', 'Medium'], ['full', 'Full width']], img.size || 'medium', (v) => updateDetails({ size: /** @type {any} */ (v) }))),
        readOnly ? null : el('div', { class: 'image-field__actions' },
          el('button', { type: 'button', class: 'btn btn--small', on: { click: choose } }, icon('restore', { size: 16 }), el('span', { class: 'btn__label', text: 'Replace' })),
          el('button', {
            type: 'button',
            class: 'btn btn--small btn--ghost',
            on: {
              click: () => {
                image = null;
                onChange(null, 'remove');
                render({});
              }
            }
          }, icon('trash', { size: 16 }), el('span', { class: 'btn__label', text: 'Remove image' })))));
  }

  // Drag a file onto the field (or, for questions, anywhere the builder forwards it).
  root.addEventListener('dragover', (event) => {
    if (readOnly || !event.dataTransfer || ![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    root.classList.add('is-drag-over');
  });
  root.addEventListener('dragleave', () => root.classList.remove('is-drag-over'));
  root.addEventListener('drop', (event) => {
    root.classList.remove('is-drag-over');
    const file = event.dataTransfer?.files?.[0];
    if (!file || readOnly) return;
    event.preventDefault();
    start(file);
  });

  render({});
  return {
    element: root,
    /** Start with a file (e.g. dropped on the card). @param {File} file */
    accept: (file) => start(file),
    choose,
    /** @param {QuizImage | null} next */
    set(next) { image = next; render({}); },
    destroy() {
      controller?.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    }
  };
}
