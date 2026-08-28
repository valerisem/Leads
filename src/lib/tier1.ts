import { fetchJson } from "./http.js";
import type { Deliverability, Tier1Result } from "./types.js";

export interface Tier1Options {
  provider: "abstract" | "checkmail";
  apiKey: string;
  timeoutMs?: number;
}

interface AbstractResponse {
  deliverability?: string;
  is_smtp_valid?: { value?: boolean };
  is_catchall_email?: { value?: boolean };
}

interface CheckMailResponse {
  valid?: boolean;
  block?: boolean;
  disposable?: boolean;
  reason?: string;
}

/**
 * Hosted verifier, consulted only when the free checks cannot decide.
 * Never throws: a Tier 1 outage must not fail the whole validation.
 */
export class Tier1Verifier {
  private readonly timeoutMs: number;

  constructor(private readonly options: Tier1Options) {
    this.timeoutMs = options.timeoutMs ?? 8000;
  }

  async verify(address: string): Promise<Tier1Result> {
    try {
      return this.options.provider === "abstract"
        ? await this.abstract(address)
        : await this.checkMail(address);
    } catch (error) {
      return {
        provider: this.options.provider,
        consulted: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async abstract(address: string): Promise<Tier1Result> {
    const url =
      `https://emailvalidation.abstractapi.com/v1/?api_key=${encodeURIComponent(this.options.apiKey)}` +
      `&email=${encodeURIComponent(address)}`;
    const body = await fetchJson<AbstractResponse>(url, { timeoutMs: this.timeoutMs });

    const deliverability = mapAbstract(body.deliverability);
    return {
      provider: "abstract",
      consulted: true,
      deliverability,
      isCatchAll: body.is_catchall_email?.value ?? undefined,
      raw: body,
    };
  }

  private async checkMail(address: string): Promise<Tier1Result> {
    const url = `https://check-mail.org/api/v1/verify?email=${encodeURIComponent(address)}&key=${encodeURIComponent(this.options.apiKey)}`;
    const body = await fetchJson<CheckMailResponse>(url, { timeoutMs: this.timeoutMs });

    let deliverability: Deliverability = "unknown";
    if (body.valid === true && body.block !== true) deliverability = "deliverable";
    else if (body.valid === false || body.block === true) deliverability = "undeliverable";

    return { provider: "checkmail", consulted: true, deliverability, raw: body };
  }
}

function mapAbstract(value: string | undefined): Deliverability {
  switch (value) {
    case "DELIVERABLE":
      return "deliverable";
    case "UNDELIVERABLE":
      return "undeliverable";
    case "RISKY":
      return "risky";
    default:
      return "unknown";
  }
}
