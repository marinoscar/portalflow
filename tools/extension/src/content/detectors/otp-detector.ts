/** Returns true if the element looks like a one-time-code / OTP input. */
export function isOtpField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;

  const autocomplete = el.getAttribute('autocomplete') ?? '';
  if (autocomplete === 'one-time-code') return true;

  const inputMode = el.getAttribute('inputmode') ?? '';
  const maxLength = el.maxLength;
  if (inputMode === 'numeric' && maxLength >= 4 && maxLength <= 8) return true;

  const name = (el.getAttribute('name') ?? '').toLowerCase();
  const id = (el.id ?? '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') ?? '').toLowerCase();
  const placeholder = (el.getAttribute('placeholder') ?? '').toLowerCase();
  const haystack = `${name} ${id} ${ariaLabel} ${placeholder}`;

  if (/\b(otp|one.?time|verification|2fa|auth.?code|security.?code)\b/.test(haystack)) {
    return true;
  }
  // "code" alone is too common; require a numeric maxLength as well
  if (/\bcode\b/.test(haystack) && maxLength >= 4 && maxLength <= 8) return true;

  return false;
}
