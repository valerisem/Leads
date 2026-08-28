import { describe, expect, it } from "vitest";
import { buildValidator } from "./helpers.js";

const ZONES = {
  "icloud.com": { mx: true, a: true },
  "gmail.com": { mx: true, a: true },
  "acme-brands.com": { mx: true, a: true },
  "nomx-example.com": { a: true },          // resolves, but cannot be mailed properly
  "flaky-example.com": { fail: true },      // resolver outage
  "mailinator.com": { mx: true, a: true },  // real MX, still disposable
};

const codes = (signals: { code: string }[]) => signals.map((s) => s.code);

describe("LeadValidator", () => {
  it("scores the real GAds sample submission as invalid", async () => {
    // Verbatim from the Salesmate notification: every DNS check passes, yet
    // the submission is plainly junk.
    const result = await buildValidator(ZONES).validate({
      fullName: "Alexandra Musorin",
      email: "alexandra.mus@icloud.com",
      phone: "01701850156",
      companyName: "Alexandra",
      companyWebsite: "url",
      country: "Cyprus",
      budget: "Below $10k",
      message: "idk",
    });

    expect(result.email.hasMx).toBe(true);
    expect(result.email.deliverability).toBe("deliverable");
    expect(codes(result.signals)).toEqual(
      expect.arrayContaining([
        "email_free_provider",
        "website_not_a_url",
        "company_name_is_person_name",
        "message_no_information",
        "budget_lowest_band",
      ]),
    );
    expect(result.verdict).toBe("invalid");
  });

  it("scores a genuine company enquiry as valid", async () => {
    const result = await buildValidator(ZONES).validate({
      fullName: "Jane Doe",
      email: "jane.doe@acme-brands.com",
      phone: "+44 20 7946 0000",
      companyName: "Acme Brands",
      companyWebsite: "https://www.acme-brands.com",
      country: "United Kingdom",
      budget: "$50k - $100k",
      message:
        "We are launching a skincare line in the UK this autumn and want TikTok creator campaigns to support it.",
    });

    expect(result.verdict).toBe("valid");
    expect(result.website.matchesEmailDomain).toBe(true);
    expect(codes(result.signals)).toContain("email_matches_website");
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("treats a disposable domain as a hard fail even with valid MX", async () => {
    const result = await buildValidator(ZONES).validate({
      fullName: "Test Person",
      email: "throwaway@mailinator.com",
      companyName: "Acme Brands",
      companyWebsite: "acme-brands.com",
      message: "We would like to discuss a large influencer campaign for Q4.",
    });

    expect(result.email.isDisposable).toBe(true);
    expect(result.verdict).toBe("invalid");
    expect(result.score).toBe(0);
  });

  it("rejects a malformed address without needing DNS", async () => {
    const result = await buildValidator(ZONES).validate({ email: "not-an-email" });
    expect(codes(result.signals)).toContain("email_syntax_invalid");
    expect(result.verdict).toBe("invalid");
    expect(result.email.domain).toBeNull();
  });

  it("rejects a domain with no DNS records at all", async () => {
    const result = await buildValidator(ZONES).validate({
      email: "someone@definitely-not-registered-xyz.com",
      companyName: "Acme",
      companyWebsite: "acme-brands.com",
      message: "We want to run a campaign with a serious budget this quarter.",
    });
    expect(codes(result.signals)).toContain("email_domain_no_records");
    expect(result.verdict).toBe("invalid");
  });

  it("downgrades but does not reject a domain with an A record and no MX", async () => {
    const result = await buildValidator(ZONES).validate({
      fullName: "Sam Smith",
      email: "sam@nomx-example.com",
      phone: "+1 555 0100",
      companyName: "NoMX Ltd",
      companyWebsite: "nomx-example.com",
      message: "We are interested in a long-term creator partnership for our new range.",
    });

    expect(codes(result.signals)).toContain("email_domain_no_mx");
    expect(result.email.deliverability).toBe("risky");
    expect(result.verdict).not.toBe("invalid");
  });

  it("does not blame the lead when the resolver is unreachable", async () => {
    const result = await buildValidator(ZONES).validate({
      fullName: "Chris Blue",
      email: "chris@flaky-example.com",
      phone: "+1 555 0111",
      companyName: "Flaky Ltd",
      companyWebsite: "flaky-example.com",
      message: "We would like to book a call about a multi-market campaign next month.",
    });

    expect(codes(result.signals)).toContain("dns_lookup_failed");
    expect(result.verdict).not.toBe("invalid");
  });

  it("flags a free provider without rejecting an otherwise solid enquiry", async () => {
    const result = await buildValidator(ZONES).validate({
      fullName: "Priya Patel",
      email: "priya.patel@gmail.com",
      phone: "+44 7700 900000",
      companyName: "Lumen Skincare",
      companyWebsite: "acme-brands.com",
      message:
        "I run marketing at Lumen Skincare and we have budget approved for a TikTok launch campaign in Q1.",
    });

    expect(result.email.isFreeProvider).toBe(true);
    expect(result.verdict).toBe("suspicious");
  });

  it("orders signals with the most severe first", async () => {
    const result = await buildValidator(ZONES).validate({
      email: "alexandra.mus@icloud.com",
      fullName: "Alexandra Musorin",
      companyName: "Alexandra",
      companyWebsite: "url",
      message: "idk",
    });
    const severities = result.signals.map((s) => s.severity);
    const rank = { hard: 0, major: 1, minor: 2, positive: 3 } as const;
    expect(severities.map((s) => rank[s])).toEqual([...severities.map((s) => rank[s])].sort());
  });

  it("exposes reasons as plain sentences for the Discord card", async () => {
    const result = await buildValidator(ZONES).validate({
      email: "alexandra.mus@icloud.com",
      companyWebsite: "url",
    });
    expect(result.reasons.length).toBe(result.signals.length);
    expect(result.reasons.every((r) => typeof r === "string" && r.length > 0)).toBe(true);
  });
});
