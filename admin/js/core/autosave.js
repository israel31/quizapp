// @ts-check
/**
 * Autosave with an honest status (section 21):
 * - saves about 1.5 s after typing stops, when a field is left, or on demand
 *   (Ctrl/Cmd+S, switching tabs, opening Preview);
 * - only one save runs at a time, and edits made meanwhile are saved next;
 * - only the changed fields are sent, with the version being edited;
 * - "saved" is only shown once the server confirms it;
 * - failures keep the changes in memory and retry with growing delays;
 * - offline waits for the connection; an expired session or a conflict
 *   pauses saving until the page resolves it (sign in again / reload).
 * The network call itself is injected, so this works for any form. A form
 * with several kinds of change (quiz details AND questions) passes its own
 * `diff` and `commit`: each save sends the most important pending change,
 * and saving carries straight on until everything asked for is stored.
 */

/** @typedef {'saved' | 'dirty' | 'saving' | 'error' | 'offline' | 'auth' | 'conflict' | 'invalid' | 'gone' | 'readonly'} SaveStatus */
/** @typedef {'error' | 'offline' | 'auth' | 'conflict' | 'invalid' | 'gone' | 'readonly'} FailureKind */

/**
 * @typedef {Object} SaveState
 * @property {SaveStatus} status
 * @property {number | null} savedAt              when the server last confirmed a save (ms)
 * @property {number} retryAt                      when the next automatic retry happens (ms), for "error"
 * @property {Record<string, string>} fieldErrors  per-field messages for "invalid"
 * @property {unknown} error
 */

/** Waits between automatic retries: 2 s, 4 s, 8 s, 16 s, then every 30 s. */
export const RETRY_DELAYS = Object.freeze([2000, 4000, 8000, 16000, 30000]);

/** @param {number} attempt  0 for the first retry */
export function retryDelay(attempt) {
  return RETRY_DELAYS[Math.min(Math.max(0, attempt), RETRY_DELAYS.length - 1)];
}

/** How values are compared: surrounding spaces and Windows line endings don't count as changes. */
export const normalizeValue = (/** @type {unknown} */ value) => String(value ?? '').replace(/\r\n/g, '\n').trim();

/**
 * The fields whose (normalized) values differ.
 * @param {Record<string, string>} saved
 * @param {Record<string, string>} current
 * @param {readonly string[]} fields
 * @returns {Record<string, string>}
 */
export function diffFields(saved, current, fields) {
  /** @type {Record<string, string>} */
  const changes = {};
  for (const field of fields) {
    if (normalizeValue(current[field]) !== normalizeValue(saved[field])) changes[field] = current[field] ?? '';
  }
  return changes;
}

/** @typedef {Record<string, any>} Values */

/**
 * @typedef {Object} AutosaveOptions
 * @property {readonly string[]} fields            text fields compared by the default diff
 * @property {Values} values                        what the server has now
 * @property {number} version
 * @property {number} [delay]                       ms of quiet before saving (default 1500)
 * @property {(values: Values) => Record<string, string>} [validate]   messages for invalid fields
 * @property {(changes: any, version: number) => Promise<{ version: number, result?: unknown }>} save
 * @property {(error: unknown) => FailureKind} classify
 * @property {(state: SaveState, previous: SaveState) => void} onChange
 * @property {(result: unknown) => void} [onSaved]
 * @property {(saved: Values, current: Values) => any} [diff]        the next change to send, or null when there's nothing
 * @property {(saved: Values, sent: any, result: unknown) => Values} [commit]   what the server has after `sent` was saved
 */

/** @param {AutosaveOptions} options */
export function createAutosave({ fields, values, version: startVersion, delay = 1500, validate, save, classify, onChange, onSaved, diff, commit }) {
  const nextChange = diff || ((/** @type {Values} */ a, /** @type {Values} */ b) => {
    const changed = diffFields(a, b, fields);
    return Object.keys(changed).length ? changed : null;
  });
  const apply = commit || ((/** @type {Values} */ before, /** @type {any} */ sent) => ({ ...before, ...sent }));
  let saved = { ...values };
  let current = { ...values };
  let version = startVersion;
  let timer = 0;
  let retryTimer = 0;
  let attempt = 0;
  /** @type {Promise<boolean> | null} */
  let inFlight = null;
  let paused = false;     // auth, conflict, gone: wait for the page to resolve it
  let readonly = false;

  /** @type {SaveState} */
  let state = { status: 'saved', savedAt: null, retryAt: 0, fieldErrors: {}, error: null };
  /** @param {Partial<SaveState>} patch */
  const set = (patch) => {
    const previous = state;
    state = { ...state, ...patch };
    if (state.status !== previous.status || patch.savedAt !== undefined || patch.fieldErrors !== undefined) onChange(state, previous);
  };
  const isDirty = () => nextChange(saved, current) != null;

  function schedule(ms = delay) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = 0; flush(); }, ms);
  }

  /**
   * A field changed. Re-checks it straight away so a fixed error clears,
   * then saves after the quiet period.
   * @param {string} field
   * @param {unknown} value
   */
  function update(field, value) {
    current = { ...current, [field]: value };
    if (readonly) return;
    if (paused) return;   // kept in memory; saved once the page resumes saving
    if (state.status === 'invalid' && validate) {
      const errors = validate(current);
      set({ fieldErrors: errors, status: Object.keys(errors).length ? 'invalid' : isDirty() ? 'dirty' : 'saved' });
      if (Object.keys(errors).length) return;
    }
    if (state.status === 'error' || state.status === 'offline') {
      schedule();
      return;
    }
    if (!inFlight) set({ status: isDirty() ? 'dirty' : 'saved' });
    schedule();
  }

  /**
   * Save now. Resolves true when everything typed so far is safely saved.
   * @returns {Promise<boolean>}
   */
  async function flush() {
    window.clearTimeout(timer);
    timer = 0;
    if (readonly || paused) return !isDirty();
    if (inFlight) {
      await inFlight;
      return isDirty() ? flush() : state.status === 'saved';
    }
    if (!isDirty()) {
      if (state.status !== 'saved' && state.status !== 'error') set({ status: 'saved' });
      return state.status !== 'error';
    }
    const errors = validate ? validate(current) : {};
    if (Object.keys(errors).length) {
      set({ status: 'invalid', fieldErrors: errors });
      return false;
    }
    if (!navigator.onLine) {
      set({ status: 'offline' });
      return false;
    }

    const sending = nextChange(saved, current);
    const asked = current;   // everything typed when this save started
    let more = false;
    window.clearTimeout(retryTimer);
    set({ status: 'saving', fieldErrors: {} });
    inFlight = (async () => {
      try {
        const out = await save(sending, version);
        version = out.version;
        saved = apply(saved, sending, out.result);
        attempt = 0;
        more = nextChange(saved, asked) != null;
        if (!more) set({ status: isDirty() ? 'dirty' : 'saved', savedAt: Date.now(), error: null });
        onSaved?.(out.result);
        return true;
      } catch (error) {
        const kind = classify(error);
        if (kind === 'auth' || kind === 'conflict' || kind === 'gone') {
          paused = true;
          set({ status: kind, error });
        } else if (kind === 'readonly') {
          readonly = true;
          set({ status: 'readonly', error });
        } else if (kind === 'invalid') {
          set({ status: 'invalid', error, fieldErrors: (/** @type {any} */ (error)).fieldErrors || {} });
        } else if (kind === 'offline') {
          set({ status: 'offline', error });
        } else {
          const wait = retryDelay(attempt++);
          set({ status: 'error', error, retryAt: Date.now() + wait });
          retryTimer = window.setTimeout(flush, wait);
        }
        return false;
      } finally {
        inFlight = null;
      }
    })();
    const ok = await inFlight;
    if (ok && more && !readonly && !paused) return flush();   // the rest of what was asked (e.g. several question changes)
    if (ok && isDirty() && !timer) schedule();   // more was typed while saving
    return ok;
  }

  const onOnline = () => { if (state.status === 'offline' || state.status === 'error') flush(); };
  window.addEventListener('online', onOnline);

  return {
    update,
    flush,
    get state() { return state; },
    get version() { return version; },
    values: () => ({ ...current }),
    /** What the server has, as far as this page knows. */
    savedValues: () => ({ ...saved }),
    hasUnsaved: () => !readonly && (isDirty() || Boolean(inFlight)),
    /** Retry straight away (the "Retry" button). */
    retry() {
      window.clearTimeout(retryTimer);
      return flush();
    },
    /** After signing in again: carry on saving. */
    resume() {
      paused = false;
      set({ status: isDirty() ? 'dirty' : 'saved' });
      return flush();
    },
    /** After loading the latest version from the server (conflict resolved). */
    reset(/** @type {Values} */ next, /** @type {number} */ nextVersion) {
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      saved = { ...next };
      current = { ...next };
      version = nextVersion;
      paused = false;
      attempt = 0;
      set({ status: readonly ? 'readonly' : 'saved', fieldErrors: {}, error: null });
    },
    /** Another action (publish, archive…) changed the version on the server. */
    setVersion(/** @type {number} */ next) { version = next; },
    setReadonly(/** @type {boolean} */ on) {
      readonly = on;
      if (on) {
        window.clearTimeout(timer);
        set({ status: 'readonly' });
      } else set({ status: isDirty() ? 'dirty' : 'saved' });
    },
    destroy() {
      window.clearTimeout(timer);
      window.clearTimeout(retryTimer);
      window.removeEventListener('online', onOnline);
    }
  };
}
