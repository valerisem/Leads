import { fetchText } from "./http.js";

const BLOCKLIST_URL =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf";
const ALLOWLIST_URL =
  "https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/allowlist.conf";

/**
 * Bundled fallback so a cold start with no network still blocks the obvious
 * throwaway providers. The full ~200k-domain list is fetched over the top.
 */
const SEED_DOMAINS = [
  "0-mail.com", "10minutemail.com", "20minutemail.com", "33mail.com",
  "anonaddy.com", "anonbox.net", "burnermail.io", "byom.de",
  "dispostable.com", "dropmail.me", "e4ward.com", "emailondeck.com",
  "fakeinbox.com", "getairmail.com", "getnada.com", "grr.la",
  "guerrillamail.com", "guerrillamail.info", "guerrillamail.net",
  "guerrillamailblock.com", "harakirimail.com", "inboxbear.com",
  "jetable.org", "mail-temporaire.fr", "mail7.io", "mailcatch.com",
  "maildrop.cc", "mailinator.com", "mailnesia.com", "mailsac.com",
  "mintemail.com", "mohmal.com", "moakt.com", "mytemp.email",
  "nowmymail.com", "sharklasers.com", "spam4.me", "spamgourmet.com",
  "temp-mail.org", "tempail.com", "tempinbox.com", "tempmail.net",
  "tempmailo.com", "tempr.email", "throwawaymail.com", "trashmail.com",
  "trashmail.de", "trbvm.com", "wegwerfmail.de", "yopmail.com",
  "yopmail.fr", "yopmail.net", "zetmail.com",
];

export interface DisposableListOptions {
  refreshHours: number;
  timeoutMs?: number;
  /** Skip network refreshes entirely and serve the seed list. */
  offline?: boolean;
  now?: () => number;
  /** Injectable for tests. */
  fetchList?: (url: string, timeoutMs: number) => Promise<string>;
}

export class DisposableDomainList {
  private domains: Set<string>;
  private allowed = new Set<string>();
  private lastRefreshedAt: number | null = null;
  private refreshing: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly fetchList: (url: string, timeoutMs: number) => Promise<string>;

  constructor(private readonly options: DisposableListOptions) {
    this.domains = new Set(SEED_DOMAINS);
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchList =
      options.fetchList ?? ((url, timeoutMs) => fetchText(url, { timeoutMs }));
  }

  get size(): number {
    return this.domains.size;
  }

  get lastRefreshed(): string | null {
    return this.lastRefreshedAt ? new Date(this.lastRefreshedAt).toISOString() : null;
  }

  has(domain: string): boolean {
    const key = domain.toLowerCase();
    if (this.allowed.has(key)) return false;
    return this.domains.has(key);
  }

  /** Refreshes if the list is stale. Never throws — a stale list still works. */
  async ensureFresh(): Promise<void> {
    if (this.options.offline) return;

    const staleAfter = this.options.refreshHours * 3600 * 1000;
    const isFresh =
      this.lastRefreshedAt !== null && this.now() - this.lastRefreshedAt < staleAfter;
    if (isFresh) return;

    if (this.refreshing) return this.refreshing;

    this.refreshing = this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<void> {
    try {
      const [blocklist, allowlist] = await Promise.all([
        this.fetchList(BLOCKLIST_URL, this.timeoutMs),
        this.fetchList(ALLOWLIST_URL, this.timeoutMs).catch(() => ""),
      ]);

      const parsedBlock = parseList(blocklist);
      // Only swap in a fetched list that looks plausible; a truncated response
      // must not silently shrink the blocklist to nothing.
      if (parsedBlock.size < SEED_DOMAINS.length) {
        throw new Error(`blocklist returned only ${parsedBlock.size} domains`);
      }

      for (const seed of SEED_DOMAINS) parsedBlock.add(seed);
      this.domains = parsedBlock;
      this.allowed = parseList(allowlist);
      this.lastRefreshedAt = this.now();
    } catch {
      // Keep whatever list we already have; try again on the next call.
    }
  }
}

function parseList(body: string): Set<string> {
  const out = new Set<string>();
  for (const line of body.split("\n")) {
    const domain = line.trim().toLowerCase();
    if (!domain || domain.startsWith("#")) continue;
    out.add(domain);
  }
  return out;
}
