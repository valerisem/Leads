/**
 * Shared-mailbox local parts. A lead from info@ is usually a real company but
 * rarely a named decision-maker, so it is worth a small nudge, not a rejection.
 */
export const ROLE_LOCAL_PARTS = new Set([
  "admin", "administrator", "billing", "compliance", "contact", "enquiries",
  "enquiry", "finance", "help", "hello", "hi", "hr", "info", "inquiries",
  "inquiry", "it", "jobs", "legal", "mail", "marketing", "media", "noreply",
  "no-reply", "office", "orders", "postmaster", "press", "privacy", "sales",
  "security", "support", "team", "webmaster",
]);

export function isRoleAccount(localPart: string): boolean {
  return ROLE_LOCAL_PARTS.has(localPart.toLowerCase());
}
