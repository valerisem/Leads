import { describe, expect, it } from "vitest";
import { DnsResolver } from "../src/lib/dns.js";

/**
 * Hits the real DNS-over-HTTPS resolvers. Skipped unless LIVE_DNS_TEST=true so
 * CI stays hermetic; run it to confirm the resolvers still answer as expected.
 */
const live = process.env.LIVE_DNS_TEST === "true" ? describe : describe.skip;

live("DnsResolver (live)", () => {
  const resolver = new DnsResolver({ timeoutMs: 8000, cacheTtlSeconds: 60 });

  it("finds MX for a real mail domain", async () => {
    const records = await resolver.lookup("houseofmarketers.com");
    expect(records.lookupFailed).toBe(false);
    expect(records.hasMx).toBe(true);
  }, 20_000);

  it("finds MX for icloud.com, showing MX alone cannot judge lead quality", async () => {
    const records = await resolver.lookup("icloud.com");
    expect(records.hasMx).toBe(true);
  }, 20_000);

  it("reports no records for an unregistered domain", async () => {
    const records = await resolver.lookup("this-domain-should-not-exist-9f8a7b6c.com");
    expect(records.lookupFailed).toBe(false);
    expect(records.hasMx).toBe(false);
    expect(records.hasAddressRecord).toBe(false);
  }, 20_000);
});
