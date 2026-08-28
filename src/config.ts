import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),

  /** Shared secret. When set, every /validate call must send `x-api-key`. */
  API_KEY: z.string().min(1).optional(),

  /** How long a DNS answer is reused, in seconds. */
  DNS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  DNS_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),

  /** How often the disposable-domain blocklist is refreshed, in hours. */
  DISPOSABLE_REFRESH_HOURS: z.coerce.number().positive().default(24),
  /** Skip the network fetch and rely on the bundled seed list (used by tests). */
  DISPOSABLE_OFFLINE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Optional hosted verifier. Absent means Tier 1 never runs. */
  EMAIL_VERIFY_PROVIDER: z.enum(["abstract", "checkmail"]).optional(),
  EMAIL_VERIFY_API_KEY: z.string().min(1).optional(),

  /** Score at or above which a lead is `valid`. */
  SCORE_VALID_THRESHOLD: z.coerce.number().int().default(70),
  /** Score at or above which a lead is `suspicious` rather than `invalid`. */
  SCORE_SUSPICIOUS_THRESHOLD: z.coerce.number().int().default(40),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const config = parsed.data;

  if (config.EMAIL_VERIFY_PROVIDER && !config.EMAIL_VERIFY_API_KEY) {
    throw new Error(
      "EMAIL_VERIFY_PROVIDER is set but EMAIL_VERIFY_API_KEY is missing — " +
        "either supply the key or unset the provider to run Tier 0 only.",
    );
  }
  if (config.SCORE_SUSPICIOUS_THRESHOLD >= config.SCORE_VALID_THRESHOLD) {
    throw new Error(
      "SCORE_SUSPICIOUS_THRESHOLD must be below SCORE_VALID_THRESHOLD.",
    );
  }
  return config;
}
