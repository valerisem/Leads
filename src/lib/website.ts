/**
 * Form fields hold anything: "url", "n/a", "acme.com", "www.acme.com",
 * "https://acme.com/about". Extract a hostname when there is a real one.
 */
const HOSTNAME_PATTERN =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

const PLACEHOLDERS = new Set([
  "url", "urls", "website", "www", "n/a", "na", "none", "no", "-", "--",
  "tbc", "tbd", "test", "nil", "null", "undefined", "example.com",
  "yourcompany.com", "company.com", "site", "web", "link", "idk", ".",
]);

export interface ParsedWebsite {
  hostname: string;
}

/** Returns null when the value is a placeholder or not a hostname at all. */
export function parseWebsite(value: string | null | undefined): ParsedWebsite | null {
  if (!value) return null;

  let candidate = value.trim().toLowerCase();
  if (!candidate) return null;
  if (PLACEHOLDERS.has(candidate)) return null;

  // Some people paste an email address into the website field.
  if (candidate.includes("@")) return null;

  if (!candidate.includes("://")) candidate = `https://${candidate}`;

  let hostname: string;
  try {
    hostname = new URL(candidate).hostname;
  } catch {
    return null;
  }

  hostname = hostname.replace(/^www\./, "");
  if (!hostname || !HOSTNAME_PATTERN.test(hostname)) return null;
  if (PLACEHOLDERS.has(hostname)) return null;

  return { hostname };
}

/** True when the two hostnames are the same site, ignoring a `www.` prefix. */
export function sameSite(a: string, b: string): boolean {
  return a.replace(/^www\./, "") === b.replace(/^www\./, "");
}
