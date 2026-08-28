import type { DnsResolver } from "./dns.js";
import type { DisposableDomainList } from "./disposable.js";
import { parseEmail } from "./email.js";
import { assessFormQuality } from "./formQuality.js";
import { isFreeProvider } from "./freeProviders.js";
import { isRoleAccount } from "./roleAccounts.js";
import type { LivenessChecker, LivenessResult } from "./liveness.js";
import type { Tier1Verifier } from "./tier1.js";
import { parseWebsite, sameSite } from "./website.js";
import type {
  Deliverability,
  EmailAssessment,
  LeadInput,
  Signal,
  ValidationResult,
  Verdict,
  WebsiteAssessment,
} from "./types.js";

const VERDICT_RANK: Record<Verdict, number> = {
  invalid: 0,
  suspicious: 1,
  valid: 2,
};

const SEVERITY_ORDER: Record<Signal["severity"], number> = {
  hard: 0,
  major: 1,
  minor: 2,
  positive: 3,
};

export interface ValidatorOptions {
  dns: DnsResolver;
  disposable: DisposableDomainList;
  /** Omit to skip the live-site check and judge on DNS alone. */
  liveness?: LivenessChecker;
  tier1?: Tier1Verifier;
  validThreshold: number;
  suspiciousThreshold: number;
  now?: () => Date;
}

export class LeadValidator {
  private readonly now: () => Date;

  constructor(private readonly options: ValidatorOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async validate(input: LeadInput): Promise<ValidationResult> {
    await this.options.disposable.ensureFresh();

    const signals: Signal[] = [];
    const email = await this.assessEmail(input, signals);
    const website = await this.assessWebsite(input, email, signals);
    signals.push(...assessFormQuality(input));

    // Tier 1 only earns its quota when the free checks left the answer open.
    let tier1;
    if (this.shouldConsultTier1(email)) {
      tier1 = await this.options.tier1!.verify(email.address!);
      if (tier1.consulted && tier1.deliverability) {
        email.deliverability = tier1.deliverability;
        if (tier1.deliverability === "undeliverable") {
          signals.push({
            code: "tier1_undeliverable",
            label: `${tier1.provider} reports the mailbox is undeliverable`,
            severity: "hard",
            weight: 100,
          });
        } else if (tier1.isCatchAll) {
          signals.push({
            code: "tier1_catch_all",
            label: `${tier1.provider} reports a catch-all domain, so the mailbox is unconfirmed`,
            severity: "minor",
            weight: 8,
          });
        }
      }
    }

    signals.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const { verdict, score } = this.score(signals);

    return {
      verdict,
      score,
      email,
      website,
      signals,
      reasons: signals.map((s) => s.label),
      checkedAt: this.now().toISOString(),
      ...(tier1 ? { tier1 } : {}),
    };
  }

  private async assessEmail(input: LeadInput, signals: Signal[]): Promise<EmailAssessment> {
    const parsed = parseEmail(input.email);

    if (!parsed) {
      signals.push({
        code: "email_syntax_invalid",
        label: input.email
          ? `"${input.email}" is not a valid email address`
          : "No email address given",
        severity: "hard",
        weight: 100,
      });
      return {
        address: null,
        domain: null,
        deliverability: "undeliverable",
        hasMx: false,
        hasAddressRecord: false,
        isDisposable: false,
        isFreeProvider: false,
        isRoleAccount: false,
      };
    }

    const isDisposable = this.options.disposable.has(parsed.domain);
    const free = isFreeProvider(parsed.domain);
    const role = isRoleAccount(parsed.localPart);
    const records = await this.options.dns.lookup(parsed.domain);

    let deliverability: Deliverability = "unknown";

    if (isDisposable) {
      signals.push({
        code: "email_disposable",
        label: `${parsed.domain} is a disposable/throwaway mail provider`,
        severity: "hard",
        weight: 100,
      });
      deliverability = "risky";
    }

    if (records.lookupFailed) {
      signals.push({
        code: "dns_lookup_failed",
        label: `Could not resolve DNS for ${parsed.domain} — records unverified`,
        severity: "minor",
        weight: 5,
      });
    } else if (!records.hasMx && !records.hasAddressRecord) {
      // Nothing at all in DNS: the domain cannot receive mail.
      signals.push({
        code: "email_domain_no_records",
        label: `${parsed.domain} has no DNS records at all and cannot receive mail`,
        severity: "hard",
        weight: 100,
      });
      deliverability = "undeliverable";
    } else if (!records.hasMx) {
      // RFC 5321 permits falling back to the A record, so this is doubt, not death.
      signals.push({
        code: "email_domain_no_mx",
        label: `${parsed.domain} has no MX record, only an address record`,
        severity: "major",
        weight: 25,
      });
      deliverability = "risky";
    } else if (deliverability === "unknown") {
      deliverability = "deliverable";
    }

    if (free) {
      // Capped rather than merely penalised: a well-written enquiry from a
      // personal address is worth reading, but it is never a confirmed
      // company contact, and no amount of good prose should promote it.
      signals.push({
        code: "email_free_provider",
        label: `${parsed.domain} is a personal mailbox provider, not a company domain`,
        severity: "major",
        weight: 20,
        capsVerdictAt: "suspicious",
      });
    }

    if (role) {
      signals.push({
        code: "email_role_account",
        label: `${parsed.localPart}@ is a shared mailbox rather than a named person`,
        severity: "minor",
        weight: 5,
      });
    }

    return {
      address: parsed.address,
      domain: parsed.domain,
      deliverability,
      hasMx: records.hasMx,
      hasAddressRecord: records.hasAddressRecord,
      isDisposable,
      isFreeProvider: free,
      isRoleAccount: role,
    };
  }

  private async assessWebsite(
    input: LeadInput,
    email: EmailAssessment,
    signals: Signal[],
  ): Promise<WebsiteAssessment> {
    const raw = input.companyWebsite?.trim() || null;
    const stated = parseWebsite(raw);

    // When the website field is junk or blank, a corporate email domain is the
    // best available guess at the company's site, and it is worth checking.
    const inferred =
      !stated && email.domain && !email.isFreeProvider ? email.domain : null;
    const hostname = stated?.hostname ?? inferred;

    if (!stated) {
      signals.push(
        raw
          ? {
              code: "website_not_a_url",
              label: `Company website "${raw}" is not a real web address`,
              severity: "major",
              weight: 30,
            }
          : {
              code: "website_missing",
              label: "No company website given",
              severity: "major",
              weight: 20,
            },
      );
    }

    if (!hostname) {
      return {
        raw,
        hostname: null,
        parsed: false,
        resolves: false,
        liveness: null,
        httpStatus: null,
        finalUrl: null,
        inferredFromEmailDomain: false,
        matchesEmailDomain: false,
      };
    }

    const inferredFromEmailDomain = !stated;
    const where = inferredFromEmailDomain
      ? `${hostname} (from the email domain)`
      : hostname;

    const records = await this.options.dns.lookup(hostname);
    const resolves = records.hasAddressRecord || records.hasMx;

    let liveness: LivenessResult | null = null;

    if (records.lookupFailed) {
      signals.push({
        code: "website_lookup_failed",
        label: `Could not resolve DNS for ${where} — site unverified`,
        severity: "minor",
        weight: 5,
      });
    } else if (!resolves) {
      signals.push({
        code: "website_does_not_resolve",
        label: `Company website ${where} does not exist in DNS`,
        severity: "major",
        weight: inferredFromEmailDomain ? 10 : 25,
        ...(inferredFromEmailDomain ? {} : { capsVerdictAt: "suspicious" as const }),
      });
    } else if (this.options.liveness) {
      // DNS says the domain exists. That is not the same as a working site,
      // so actually fetch the homepage and see what comes back.
      liveness = await this.options.liveness.check(hostname);
      signals.push(...livenessSignals(liveness, where, inferredFromEmailDomain));
    }

    const matchesEmailDomain =
      !inferredFromEmailDomain &&
      email.domain !== null &&
      sameSite(hostname, email.domain);

    if (matchesEmailDomain) {
      // The strongest positive available for free: their address is on their own site.
      signals.push({
        code: "email_matches_website",
        label: `Email address is on the company's own domain (${hostname})`,
        severity: "positive",
        weight: -15,
      });
    }

    return {
      raw,
      hostname,
      parsed: Boolean(stated),
      resolves,
      liveness: liveness?.state ?? null,
      httpStatus: liveness?.status ?? null,
      finalUrl: liveness?.finalUrl ?? null,
      inferredFromEmailDomain,
      matchesEmailDomain,
    };
  }

  private shouldConsultTier1(email: EmailAssessment): boolean {
    if (!this.options.tier1 || !email.address) return false;
    // Spending quota on a case the free checks already settled is waste.
    return (
      !email.isDisposable &&
      !email.isFreeProvider &&
      email.hasMx &&
      email.deliverability !== "undeliverable"
    );
  }

  private score(signals: Signal[]): { verdict: Verdict; score: number } {
    if (signals.some((s) => s.severity === "hard")) {
      return { verdict: "invalid", score: 0 };
    }

    const deductions = signals.reduce((total, s) => total + s.weight, 0);
    const score = Math.max(0, Math.min(100, 100 - deductions));

    const fromScore: Verdict =
      score >= this.options.validThreshold
        ? "valid"
        : score >= this.options.suspiciousThreshold
          ? "suspicious"
          : "invalid";

    // The strictest cap any signal imposes wins over the score.
    const verdict = signals.reduce<Verdict>(
      (current, signal) =>
        signal.capsVerdictAt && VERDICT_RANK[signal.capsVerdictAt] < VERDICT_RANK[current]
          ? signal.capsVerdictAt
          : current,
      fromScore,
    );

    return { verdict, score };
  }
}

/**
 * A domain that resolves but serves nothing is the case DNS alone cannot catch:
 * parked shells and dead sites both have perfectly good A records.
 */
function livenessSignals(
  liveness: LivenessResult,
  where: string,
  inferred: boolean,
): Signal[] {
  // An inferred hostname is a guess, so it carries less weight than a website
  // the person actually typed into the form.
  const scale = (weight: number) => (inferred ? Math.round(weight / 2) : weight);

  switch (liveness.state) {
    case "live":
      return [
        {
          code: "website_live",
          label: `Company website ${where} is live`,
          severity: "positive",
          weight: -10,
        },
      ];

    case "protected":
      // Neutral on purpose: a bot-blocked response proves a server is there but
      // proves nothing about the content, so it earns neither credit nor blame.
      return [
        {
          code: "website_protected",
          label:
            `Company website ${where} responds but blocks automated checks ` +
            `(HTTP ${liveness.status}) — content unverified`,
          severity: "minor",
          weight: 0,
        },
      ];

    case "parked":
      return [
        {
          code: "website_parked",
          label: `Company website ${where} is a parked / for-sale domain, not a real site`,
          severity: "major",
          weight: scale(35),
          // A company with no real website is never a confirmed prospect,
          // however well the rest of the form reads.
          ...(inferred ? {} : { capsVerdictAt: "suspicious" as const }),
        },
      ];

    case "placeholder":
      return [
        {
          code: "website_placeholder",
          label: `Company website ${where} serves only a placeholder page`,
          severity: "major",
          weight: scale(20),
        },
      ];

    case "http_error":
      return [
        {
          code: "website_http_error",
          label: `Company website ${where} returns HTTP ${liveness.status}`,
          severity: "major",
          weight: scale(20),
        },
      ];

    case "unreachable":
      return [
        {
          code: "website_unreachable",
          label: `Company website ${where} resolves in DNS but serves no website`,
          severity: "major",
          weight: scale(30),
          ...(inferred ? {} : { capsVerdictAt: "suspicious" as const }),
        },
      ];
  }
}
