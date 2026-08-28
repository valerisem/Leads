import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";

const BASE_ENV = { DISPOSABLE_OFFLINE: "true", LOG_LEVEL: "silent" };

describe("server", () => {
  it("serves health without a key even when one is configured", async () => {
    const { app } = buildServer(loadConfig({ ...BASE_ENV, API_KEY: "secret" } as never));
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "ok" });
    await app.close();
  });

  it("rejects /validate without the configured key", async () => {
    const { app } = buildServer(loadConfig({ ...BASE_ENV, API_KEY: "secret" } as never));
    const response = await app.inject({
      method: "POST",
      url: "/validate",
      payload: { email: "a@b.com" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("accepts /validate with the configured key", async () => {
    const { app } = buildServer(loadConfig({ ...BASE_ENV, API_KEY: "secret" } as never));
    const response = await app.inject({
      method: "POST",
      url: "/validate",
      headers: { "x-api-key": "secret" },
      payload: { email: "definitely not an email" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().verdict).toBe("invalid");
    await app.close();
  });

  it("400s on a malformed body", async () => {
    const { app } = buildServer(loadConfig(BASE_ENV as never));
    const response = await app.inject({
      method: "POST",
      url: "/validate",
      payload: { email: 42 },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("caps batch size", async () => {
    const { app } = buildServer(loadConfig(BASE_ENV as never));
    const response = await app.inject({
      method: "POST",
      url: "/validate/batch",
      payload: { leads: Array.from({ length: 51 }, () => ({ email: "a@b.com" })) },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
