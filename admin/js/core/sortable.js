// @ts-check
/**
 * Drag-to-reorder with Pointer Events, so mouse, pen and touch all work
 * (section 19). Grab the visible handle: the item lifts, a gap opens where it
 * will land, and the others glide out of the way. Esc cancels. The list
 * scrolls when you drag near the top or bottom of the screen.
 * This is the pointer shortcut only — every list that uses it also has
 * keyboard-friendly Move up / Move down controls.
 */
import { prefersReducedMotion } from './motion.js';

/**
 * @typedef {Object} SortableOptions
 * @property {string} item       selector for the sortable items (direct children of the list)
 * @property {string} handle     selector for the drag handle inside an item
 * @property {(from: number, to: number, before: DOMRect) => void} onMove   before = where the item was let go, to glide a redrawn item
 * @property {() => boolean} [enabled]
 */

/**
 * @param {HTMLElement} list
 * @param {SortableOptions} options
 * @returns {() => void} remove the listeners
 */
export function makeSortable(list, { item, handle, onMove, enabled = () => true }) {
  /** @type {null | {
   *   pointerId: number, dragged: HTMLElement, items: HTMLElement[], rects: DOMRect[], from: number, to: number,
   *   startY: number, startScroll: number, lastY: number, height: number, raf: number
   * }} */
  let drag = null;

  /** @param {PointerEvent} event */
  function onDown(event) {
    if (event.button !== 0 || !enabled()) return;
    const target = /** @type {HTMLElement} */ (event.target);
    const grip = target.closest(handle);
    if (!grip || !list.contains(grip)) return;
    const dragged = /** @type {HTMLElement | null} */ (grip.closest(item));
    if (!dragged || dragged.parentElement !== list) return;
    event.preventDefault();
    const items = /** @type {HTMLElement[]} */ ([...list.children].filter((child) => child.matches(item)));
    const from = items.indexOf(dragged);
    if (from < 0) return;
    const rects = items.map((node) => node.getBoundingClientRect());
    const next = rects[from + 1];
    const prev = rects[from - 1];
    const gap = next ? next.top - rects[from].bottom : prev ? rects[from].top - prev.bottom : 8;
    drag = {
      pointerId: event.pointerId, dragged, items, rects, from, to: from,
      startY: event.clientY, startScroll: window.scrollY, lastY: event.clientY,
      height: rects[from].height + Math.max(0, gap), raf: 0
    };
    try { grip.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    list.classList.add('is-sorting');
    dragged.classList.add('is-dragging');
    document.documentElement.classList.add('is-holding');
    grip.addEventListener('pointermove', onMoveEvent);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
    autoScroll();
  }

  function update() {
    if (!drag) return;
    const { dragged, items, rects, from, height } = drag;
    const scrolled = window.scrollY - drag.startScroll;
    const dy = drag.lastY - drag.startY + scrolled;
    dragged.style.transform = `translateY(${dy}px) scale(1.02)`;
    // Where would the middle of the dragged item land?
    const middle = rects[from].top + rects[from].height / 2 + dy;
    let to = from;
    for (let i = 0; i < items.length; i += 1) {
      if (i === from) continue;
      const centre = rects[i].top + rects[i].height / 2;
      if (i < from && middle < centre) { to = Math.min(to, i); }
      if (i > from && middle > centre) { to = Math.max(to, i); }
    }
    drag.to = to;
    items.forEach((node, i) => {
      if (i === from) return;
      let shift = 0;
      if (from < to && i > from && i <= to) shift = -height;
      if (from > to && i < from && i >= to) shift = height;
      node.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  }

  /** @param {PointerEvent} event */
  function onMoveEvent(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.lastY = event.clientY;
    update();
  }

  /** Scroll the page when dragging near the top or bottom edge. */
  function autoScroll() {
    if (!drag) return;
    const edge = 72;
    const y = drag.lastY;
    let speed = 0;
    if (y < edge) speed = -Math.ceil((edge - y) / 6);
    else if (y > window.innerHeight - edge) speed = Math.ceil((y - (window.innerHeight - edge)) / 6);
    if (speed) {
      window.scrollBy(0, speed);
      update();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  /** @param {boolean} commit */
  function finish(commit) {
    if (!drag) return;
    const { dragged, items, from, to, raf } = drag;
    cancelAnimationFrame(raf);
    const grip = dragged.querySelector(handle);
    grip?.removeEventListener('pointermove', onMoveEvent);
    grip?.removeEventListener('pointerup', onUp);
    grip?.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
    document.documentElement.classList.remove('is-holding');
    const before = dragged.getBoundingClientRect();
    list.classList.add('is-settling');
    items.forEach((node) => { node.style.transform = ''; });
    dragged.classList.remove('is-dragging');
    list.classList.remove('is-sorting');
    drag = null;
    if (commit && to !== from) onMove(from, to, before);
    // Glide the dropped item from where it was let go to its new place.
    requestAnimationFrame(() => {
      list.classList.remove('is-settling');
      if (prefersReducedMotion() || !dragged.isConnected) return;
      const after = dragged.getBoundingClientRect();
      const dy = before.top - after.top;
      if (Math.abs(dy) > 1) {
        dragged.animate([{ transform: `translateY(${dy}px) scale(1.02)` }, { transform: 'none' }],
          { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
    });
  }

  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    }
  }

  list.addEventListener('pointerdown', onDown);
  return () => list.removeEventListener('pointerdown', onDown);
}
