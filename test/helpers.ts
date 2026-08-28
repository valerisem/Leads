import { DisposableDomainList } from "../src/lib/disposable.js";
import { DnsResolver } from "../src/lib/dns.js";
import { LeadValidator } from "../src/lib/validator.js";

export interface FakeZone {
  mx?: boolean;
  a?: boolean;
  /** Simulate every resolver failing for this domain. */
  fail?: boolean;
}

/**
 * A DnsResolver whose network layer is replaced by a fixture table, so the
 * suite is deterministic and needs no outbound access. Unknown domains behave
 * like NXDOMAIN.
 */
export function fakeDns(zones: Record<string, FakeZone>): DnsResolver {
  const resolver = new DnsResolver({ timeoutMs: 1000, cacheTtlSeconds: 60 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (resolver as any).resolve = async (domain: string) => {
    const zone = zones[domain];
    if (!zone) return { hasMx: false, hasAddressRecord: false, lookupFailed: false };
    if (zone.fail) return { hasMx: false, hasAddressRecord: false, lookupFailed: true };
    return {
      hasMx: zone.mx ?? false,
      hasAddressRecord: zone.a ?? false,
      lookupFailed: false,
    };
  };
  return resolver;
}

export function offlineDisposableList(): DisposableDomainList {
  return new DisposableDomainList({ refreshHours: 24, offline: true });
}

export function buildValidator(zones: Record<string, FakeZone>): LeadValidator {
  return new LeadValidator({
    dns: fakeDns(zones),
    disposable: offlineDisposableList(),
    validThreshold: 70,
    suspiciousThreshold: 40,
  });
}
