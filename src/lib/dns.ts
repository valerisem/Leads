import { fetchJson } from "./http.js";

/** Shape returned by both Cloudflare's and Google's DNS-over-HTTPS JSON APIs. */
interface DohResponse {
  Status: number;
  Answer?: Array<{ name: string; type: number; TTL: number; data: string }>;
}

const RESOLVERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

const NXDOMAIN = 3;

export interface DomainRecords {
  /** False only when we got a definitive answer with no records. */
  hasMx: boolean;
  hasAddressRecord: boolean;
  /** True when every resolver failed — the caller must not treat this as "no records". */
  lookupFailed: boolean;
}

interface CacheEntry {
  value: DomainRecords;
  expiresAt: number;
}

export interface DnsResolverOptions {
  timeoutMs: number;
  cacheTtlSeconds: number;
  now?: () => number;
}

export class DnsResolver {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<DomainRecords>>();
  private readonly now: () => number;

  constructor(private readonly options: DnsResolverOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async lookup(domain: string): Promise<DomainRecords> {
    const key = domain.toLowerCase();

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.value;

    // Collapse concurrent lookups for the same domain onto one set of queries.
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const pending = this.resolve(key)
      .then((records) => {
        // A failed lookup is never cached — the next call should retry.
        if (!records.lookupFailed) {
          this.cache.set(key, {
            value: records,
            expiresAt: this.now() + this.options.cacheTtlSeconds * 1000,
          });
        }
        return records;
      })
      .finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, pending);
    return pending;
  }

  private async resolve(domain: string): Promise<DomainRecords> {
    const [mx, a, aaaa] = await Promise.all([
      this.query(domain, "MX"),
      this.query(domain, "A"),
      this.query(domain, "AAAA"),
    ]);

    // Only report "no records" when at least one query actually answered.
    if (mx === null && a === null && aaaa === null) {
      return { hasMx: false, hasAddressRecord: false, lookupFailed: true };
    }

    return {
      hasMx: mx === true,
      hasAddressRecord: a === true || aaaa === true,
      lookupFailed: false,
    };
  }

  /** Returns true/false for a definitive answer, or null when every resolver failed. */
  private async query(domain: string, type: "MX" | "A" | "AAAA"): Promise<boolean | null> {
    for (const resolver of RESOLVERS) {
      const url = `${resolver}?name=${encodeURIComponent(domain)}&type=${type}`;
      try {
        const body = await fetchJson<DohResponse>(url, {
          timeoutMs: this.options.timeoutMs,
          headers: { accept: "application/dns-json" },
        });
        if (body.Status === NXDOMAIN) return false;
        // Any other non-zero status is inconclusive; try the next resolver.
        if (body.Status !== 0) continue;
        return (body.Answer ?? []).some((answer) => answer.data.length > 0);
      } catch {
        continue;
      }
    }
    return null;
  }
}
