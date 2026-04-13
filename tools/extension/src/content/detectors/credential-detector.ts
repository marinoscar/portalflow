/** Returns true if the element looks like a password input. */
export function isPasswordField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'password') return true;

  const autocomplete = el.getAttribute('autocomplete') ?? '';
  if (/current-password|new-password/.test(autocomplete)) return true;

  const name = (el.getAttribute('name') ?? '').toLowerCase();
  const id = (el.id ?? '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') ?? '').toLowerCase();
  const haystack = `${name} ${id} ${ariaLabel}`;

  if (/\b(pass|pwd|password)\b/.test(haystack)) return true;
  return false;
}

/** Returns true if the element looks like a username/email field in a login form containing a password. */
export function isUsernameField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'password') return false;

  const autocomplete = el.getAttribute('autocomplete') ?? '';
  if (/username|email/.test(autocomplete)) {
    // Only flag as a "credential-adjacent" field if a password field exists in the same form
    return hasPasswordSiblingInForm(el);
  }

  const name = (el.getAttribute('name') ?? '').toLowerCase();
  const id = (el.id ?? '').toLowerCase();
  if (/\b(user|username|email|login)\b/.test(`${name} ${id}`)) {
    return hasPasswordSiblingInForm(el);
  }
  return false;
}

function hasPasswordSiblingInForm(el: Element): boolean {
  const form = el.closest('form');
  if (!form) return false;
  return !!form.querySelector('input[type="password"]');
}
