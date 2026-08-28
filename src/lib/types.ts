/** Severity of a single signal. `hard` signals force an `invalid` verdict on their own. */
export type Severity = "hard" | "major" | "minor" | "positive";

export interface Signal {
  /** Stable machine-readable code, safe to branch on downstream. */
  code: string;
  /** Human sentence, rendered straight onto the Discord card. */
  label: string;
  severity: Severity;
  /** Points subtracted from the 100-point score (negative values add). */
  weight: number;
  /**
   * Ceiling this signal puts on the verdict regardless of score. Some facts are
   * disqualifying on their own no matter how good the rest of the submission
   * reads — a consumer mailbox can never make a lead a confirmed company contact.
   */
  capsVerdictAt?: Verdict;
}

export type Verdict = "valid" | "suspicious" | "invalid";

export type { LivenessState } from "./liveness.js";
import type { LivenessState } from "./liveness.js";

/** How deliverable the address itself looks, independent of lead quality. */
export type Deliverability = "deliverable" | "risky" | "undeliverable" | "unknown";

export interface EmailAssessment {
  address: string | null;
  domain: string | null;
  deliverability: Deliverability;
  hasMx: boolean;
  hasAddressRecord: boolean;
  isDisposable: boolean;
  isFreeProvider: boolean;
  isRoleAccount: boolean;
}

export interface WebsiteAssessment {
  raw: string | null;
  /** Hostname we managed to parse out, or null if the value was not a URL at all. */
  hostname: string | null;
  parsed: boolean;
  /** Domain exists in DNS. Says nothing about whether a site is actually served. */
  resolves: boolean;
  /** Whether a real page is actually served: this is the live-site check. */
  liveness: LivenessState | null;
  /** HTTP status of the final response, after redirects. */
  httpStatus: number | null;
  /** URL after redirects — reveals an off-site redirect to a parking service. */
  finalUrl: string | null;
  /** True when the hostname came from the email domain, not the website field. */
  inferredFromEmailDomain: boolean;
  /** True when the website hostname and the email domain agree. */
  matchesEmailDomain: boolean;
}

export interface LeadInput {
  email?: string | null;
  fullName?: string | null;
  companyName?: string | null;
  companyWebsite?: string | null;
  /** The free-text "How can we help" answer. */
  message?: string | null;
  /** e.g. "Below $10k" */
  budget?: string | null;
  phone?: string | null;
  country?: string | null;
}

export interface ValidationResult {
  verdict: Verdict;
  /** 0-100. Higher is better. */
  score: number;
  email: EmailAssessment;
  website: WebsiteAssessment;
  signals: Signal[];
  /** Just the labels, in severity order — convenient for rendering. */
  reasons: string[];
  checkedAt: string;
  /** Present only when a hosted verifier was consulted. */
  tier1?: Tier1Result;
}

export interface Tier1Result {
  provider: string;
  consulted: boolean;
  deliverability?: Deliverability;
  isCatchAll?: boolean;
  raw?: unknown;
  error?: string;
}
