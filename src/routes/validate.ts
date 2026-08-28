import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { LeadValidator } from "../lib/validator.js";

const leadSchema = z.object({
  email: z.string().nullish(),
  fullName: z.string().nullish(),
  companyName: z.string().nullish(),
  companyWebsite: z.string().nullish(),
  message: z.string().nullish(),
  budget: z.string().nullish(),
  phone: z.string().nullish(),
  country: z.string().nullish(),
});

const MAX_BATCH = 50;
const batchSchema = z.object({
  leads: z.array(leadSchema).min(1).max(MAX_BATCH),
});

export function registerValidateRoutes(
  app: FastifyInstance,
  validator: LeadValidator,
): void {
  app.post("/validate", async (request, reply) => {
    const parsed = leadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues,
      });
    }
    return validator.validate(parsed.data);
  });

  app.post("/validate/batch", async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues,
      });
    }
    // Sequential on purpose: the DNS cache makes repeat domains free, and this
    // keeps a batch from opening 50 concurrent resolver connections.
    const results = [];
    for (const lead of parsed.data.leads) {
      results.push(await validator.validate(lead));
    }
    return { results };
  });
}
