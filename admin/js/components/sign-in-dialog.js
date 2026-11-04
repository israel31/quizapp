// @ts-check
/**
 * "Sign in to keep your changes": shown when the session expires while the
 * admin has unsaved work. Unlike other pages, the editor never redirects to
 * the login page and loses what was typed (section 21).
 */
import { CONFIG } from '../config.js';
import { api } from '../api/index.js';
import { ApiError, userMessage } from '../api/client.js';
import { el } from '../core/dom.js';
import { rules, validateValue } from '../core/validate.js';
import { formDialog } from './dialog.js';
import { setFieldError, clearFieldError, showFormAlert, hideFormMessage } from './form-feedback.js';

/** @type {Promise<boolean> | null} */
let open = null;

/**
 * @param {{ identifier?: string, reason?: string }} [options]
 * @returns {Promise<boolean>} true once signed in again
 */
export function signInAgain({ identifier = '', reason = 'Your session ended while you were working.' } = {}) {
  if (open) return open;   // one dialog at a time, however many saves hit the 401
  const usesUsername = CONFIG.AUTH.identifier === 'username';
  const idInput = el('input', {
    class: 'input', id: 'reauth-id', name: 'identifier', type: usesUsername ? 'text' : 'email',
    autocomplete: 'username', value: identifier, attrs: { autocapitalize: 'none', spellcheck: 'false', required: true }
  });
  const pwInput = el('input', { class: 'input', id: 'reauth-password', name: 'password', type: 'password', autocomplete: 'current-password', attrs: { required: true } });
  const alertSlot = el('div', { hidden: true });
  const field = (/** @type {HTMLInputElement} */ input, /** @type {string} */ label) => el('div', { class: 'field' },
    el('label', { class: 'field__label', for: input.id, text: label }),
    el('div', { class: 'field__control' }, input),
    el('div', { class: 'field__message' }, el('div', {})));

  const check = () => {
    const idError = validateValue(idInput.value, usesUsername
      ? [rules.required('Enter your username')]
      : [rules.required('Enter your email address'), rules.email()]);
    const pwError = validateValue(pwInput.value, [rules.required('Enter your password')]);
    if (idError) setFieldError(idInput, idError); else clearFieldError(idInput);
    if (pwError) setFieldError(pwInput, pwError); else clearFieldError(pwInput);
    return !idError && !pwError;
  };

  open = formDialog({
    title: 'Sign in to keep your changes',
    description: `${reason} Sign in again and your changes will be saved. Nothing you typed has been lost.`,
    body: [alertSlot, field(idInput, usesUsername ? 'Username' : 'Email'), field(pwInput, 'Password')],
    submitLabel: 'Sign in and save',
    cancelLabel: 'Not now',
    onSubmit: async () => {
      hideFormMessage(alertSlot);
      if (!check()) {
        (/** @type {HTMLInputElement} */ (idInput.getAttribute('aria-invalid') === 'true' ? idInput : pwInput)).focus();
        return undefined;
      }
      try {
        await api.login({ identifier: idInput.value, password: pwInput.value });
        return true;
      } catch (error) {
        showFormAlert(alertSlot, error instanceof ApiError && error.status === 401
          ? `${usesUsername ? 'Username' : 'Email'} or password is incorrect.`
          : userMessage(error));
        pwInput.focus();
        pwInput.select();
        return undefined;
      }
    }
  }).then((result) => Boolean(result)).finally(() => { open = null; });

  // Focus the password when the email is already known.
  if (identifier) requestAnimationFrame(() => pwInput.focus());
  return open;
}
