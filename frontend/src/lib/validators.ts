/**
 * Shared validation helpers for form fields.
 */

/**
 * Validate a phone number string.
 * Returns `null` if valid, or a user-facing error message otherwise.
 *
 * Rules:
 * - Must not be empty (required check)
 * - Must contain at least 10 digits
 */
export function validatePhoneNumber(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (!value) return "Phone number is required";
  if (digits.length < 10) return "Phone number must contain 10 digits";
  return null;
}
