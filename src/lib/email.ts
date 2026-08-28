/**
 * Deliberately permissive: this rejects the shapes a mail server would reject,
 * not the exotic-but-legal ones. Over-strict regexes reject real addresses.
 */
const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

export interface ParsedEmail {
  address: string;
  localPart: string;
  domain: string;
}

/** Returns null when the value is not a usable address. */
export function parseEmail(value: string | null | undefined): ParsedEmail | null {
  if (!value) return null;

  // Tolerate "Alexandra Musorin <a@b.com>" and stray whitespace.
  const angled = value.match(/<([^>]+)>/);
  const candidate = (angled?.[1] ?? value).trim().toLowerCase();

  if (!candidate || candidate.length > 254) return null;
  if (!EMAIL_PATTERN.test(candidate)) return null;

  const at = candidate.lastIndexOf("@");
  const localPart = candidate.slice(0, at);
  const domain = candidate.slice(at + 1);

  if (localPart.length > 64) return null;
  if (localPart.startsWith(".") || localPart.endsWith(".")) return null;
  if (domain.includes("..")) return null;

  return { address: candidate, localPart, domain };
}
