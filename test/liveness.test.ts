import { describe, expect, it } from "vitest";
import { buildValidator } from "./helpers.js";

const ZONES = {
  "acme-brands.com": { mx: true, a: true },
  "parked-example.com": { a: true },
  "dead-example.com": { a: true },
  "soon-example.com": { a: true },
  "broken-example.com": { a: true },
  "gmail.com": { mx: true, a: true },
};

const base = {
  fullName: "Jane Doe",
  phone: "+44 20 7946 0000",
  companyName: "Acme Brands",
  budget: "$50k - $100k",
  message:
    "We are launching a skincare range in the UK this autumn and want TikTok creator campaigns.",
};

const codes = (signals: { code: string }[]) => signals.map((s) => s.code);

describe("live-site checking", () => {
  it("flags a domain that resolves in DNS but serves no website", async () => {
    const validator = buildValidator(ZONES, { "dead-example.com": "unreachable" });
    const result = await validator.validate({
      ...base,
      email: "jane@dead-example.com",
      companyWebsite: "dead-example.com",
    });

    // The distinction this whole check exists for.
    expect(result.website.resolves).toBe(true);
    expect(result.website.liveness).toBe("unreachable");
    expect(codes(result.signals)).toContain("website_unreachable");
    expect(result.verdict).not.toBe("valid");
  });

  it("flags a parked / for-sale domain", async () => {
    const validator = buildValidator(ZONES, { "parked-example.com": "parked" });
    const result = await validator.validate({
      ...base,
      email: "jane@parked-example.com",
      companyWebsite: "parked-example.com",
    });

    expect(codes(result.signals)).toContain("website_parked");
    expect(result.verdict).not.toBe("valid");
  });

  it("flags a coming-soon placeholder page", async () => {
    const validator = buildValidator(ZONES, { "soon-example.com": "placeholder" });
    const result = await validator.validate({
      ...base,
      email: "jane@soon-example.com",
      companyWebsite: "soon-example.com",
    });
    expect(codes(result.signals)).toContain("website_placeholder");
  });

  it("flags a site returning an HTTP error", async () => {
    const validator = buildValidator(ZONES, { "broken-example.com": "http_error" });
    const result = await validator.validate({
      ...base,
      email: "jane@broken-example.com",
      companyWebsite: "broken-example.com",
    });
    const signal = result.signals.find((s) => s.code === "website_http_error");
    expect(signal?.label).toContain("404");
  });

  it("credits a genuinely live site", async () => {
    const validator = buildValidator(ZONES);
    const result = await validator.validate({
      ...base,
      email: "jane@acme-brands.com",
      companyWebsite: "https://www.acme-brands.com",
    });
    expect(result.website.liveness).toBe("live");
    expect(codes(result.signals)).toContain("website_live");
    expect(result.verdict).toBe("valid");
  });

  it("falls back to the email domain when the website field is junk", async () => {
    const validator = buildValidator(ZONES, { "acme-brands.com": "live" });
    const result = await validator.validate({
      ...base,
      email: "jane@acme-brands.com",
      companyWebsite: "url",
    });

    expect(result.website.inferredFromEmailDomain).toBe(true);
    expect(result.website.hostname).toBe("acme-brands.com");
    expect(result.website.liveness).toBe("live");
    // Still penalised for the junk field, but the real site is recognised.
    expect(codes(result.signals)).toContain("website_not_a_url");
  });

  it("does not guess a website from a free mailbox domain", async () => {
    const validator = buildValidator(ZONES);
    const result = await validator.validate({
      ...base,
      email: "jane@gmail.com",
      companyWebsite: "url",
    });
    expect(result.website.hostname).toBeNull();
    expect(result.website.inferredFromEmailDomain).toBe(false);
  });

  it("does not run a live check on a domain that is not in DNS", async () => {
    const validator = buildValidator(ZONES);
    const result = await validator.validate({
      ...base,
      email: "jane@acme-brands.com",
      companyWebsite: "not-registered-abc123.com",
    });
    expect(codes(result.signals)).toContain("website_does_not_resolve");
    expect(result.website.liveness).toBeNull();
  });
});

describe("bot-protected sites are not mistaken for dead ones", () => {
  it("treats an HTTP 403 as a real server, not a dead site", async () => {
    const validator = buildValidator(ZONES, { "acme-brands.com": "protected" });
    const result = await validator.validate({
      ...base,
      email: "jane@acme-brands.com",
      companyWebsite: "acme-brands.com",
    });

    // Cloudflare and friends 403 unknown user agents on plenty of real sites,
    // so this must not cost the lead its verdict.
    expect(codes(result.signals)).toContain("website_protected");
    expect(codes(result.signals)).not.toContain("website_unreachable");
    expect(result.verdict).toBe("valid");
  });
});

describe("a dead website caps the verdict", () => {
  it.each([
    ["unreachable" as const, "website_unreachable"],
    ["parked" as const, "website_parked"],
  ])("%s can never be valid, however good the rest is", async (state, code) => {
    const validator = buildValidator(ZONES, { "acme-brands.com": state });
    const result = await validator.validate({
      ...base,
      email: "jane@acme-brands.com",
      companyWebsite: "acme-brands.com",
      message:
        "We are launching across six markets with a large approved budget and need creator campaigns in each, starting next quarter.",
    });

    expect(codes(result.signals)).toContain(code);
    expect(result.verdict).not.toBe("valid");
  });

  it("caps when the stated website is not in DNS at all", async () => {
    const validator = buildValidator(ZONES);
    const result = await validator.validate({
      ...base,
      email: "jane@acme-brands.com",
      companyWebsite: "not-registered-abc123.com",
    });
    expect(result.verdict).not.toBe("valid");
  });

  it("does not cap on a guess inferred from the email domain", async () => {
    // The website field was junk, so the hostname is our inference, not their
    // claim — it should inform the score without vetoing the verdict.
    const validator = buildValidator(ZONES, { "acme-brands.com": "unreachable" });
    const result = await validator.validate({
      ...base,
      email: "jane@acme-brands.com",
      companyWebsite: "url",
    });
    expect(result.website.inferredFromEmailDomain).toBe(true);
    const signal = result.signals.find((s) => s.code === "website_unreachable");
    expect(signal?.capsVerdictAt).toBeUndefined();
  });
});
