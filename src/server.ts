import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { DisposableDomainList } from "./lib/disposable.js";
import { DnsResolver } from "./lib/dns.js";
import { Tier1Verifier } from "./lib/tier1.js";
import { LeadValidator } from "./lib/validator.js";
import { registerValidateRoutes } from "./routes/validate.js";

export interface BuiltServer {
  app: FastifyInstance;
  validator: LeadValidator;
  disposable: DisposableDomainList;
}

export function buildServer(config: Config): BuiltServer {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    // Railway terminates TLS in front of the app.
    trustProxy: true,
  });

  const dns = new DnsResolver({
    timeoutMs: config.DNS_TIMEOUT_MS,
    cacheTtlSeconds: config.DNS_CACHE_TTL_SECONDS,
  });

  const disposable = new DisposableDomainList({
    refreshHours: config.DISPOSABLE_REFRESH_HOURS,
    offline: config.DISPOSABLE_OFFLINE,
  });

  const tier1 =
    config.EMAIL_VERIFY_PROVIDER && config.EMAIL_VERIFY_API_KEY
      ? new Tier1Verifier({
          provider: config.EMAIL_VERIFY_PROVIDER,
          apiKey: config.EMAIL_VERIFY_API_KEY,
        })
      : undefined;

  const validator = new LeadValidator({
    dns,
    disposable,
    tier1,
    validThreshold: config.SCORE_VALID_THRESHOLD,
    suspiciousThreshold: config.SCORE_SUSPICIOUS_THRESHOLD,
  });

  // Health must stay reachable without a key so Railway can probe it.
  app.get("/health", async () => ({
    status: "ok",
    disposableDomains: disposable.size,
    disposableListRefreshedAt: disposable.lastRefreshed,
    tier1: config.EMAIL_VERIFY_PROVIDER ?? null,
  }));

  if (config.API_KEY) {
    app.addHook("onRequest", async (request, reply) => {
      if (request.url.startsWith("/health")) return;
      if (request.headers["x-api-key"] !== config.API_KEY) {
        await reply.code(401).send({ error: "unauthorized" });
      }
    });
  }

  registerValidateRoutes(app, validator);

  return { app, validator, disposable };
}
