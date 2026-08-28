import { DisposableDomainList } from "../src/lib/disposable.js";
import { DnsResolver } from "../src/lib/dns.js";
import { LivenessChecker, type LivenessResult, type LivenessState } from "../src/lib/liveness.js";
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

/**
 * A LivenessChecker backed by a fixture table. Hostnames with no entry are
 * treated as live, so tests only declare the sites they care about.
 */
export function fakeLiveness(
  sites: Record<string, LivenessState>,
): LivenessChecker {
  const checker = new LivenessChecker({ timeoutMs: 1000 });
  checker.check = async (hostname: string): Promise<LivenessResult> => {
    const state = sites[hostname] ?? "live";
    return {
      state,
      status: state === "unreachable" ? null : state === "http_error" ? 404 : 200,
      finalUrl: state === "unreachable" ? null : `https://${hostname}/`,
      scheme: state === "unreachable" ? null : "https",
    };
  };
  return checker;
}

export function buildValidator(
  zones: Record<string, FakeZone>,
  sites: Record<string, LivenessState> = {},
): LeadValidator {
  return new LeadValidator({
    dns: fakeDns(zones),
    disposable: offlineDisposableList(),
    liveness: fakeLiveness(sites),
    validThreshold: 70,
    suspiciousThreshold: 40,
  });
}
