import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({} as never);
    expect(config.PORT).toBe(8080);
    expect(config.SCORE_VALID_THRESHOLD).toBe(70);
  });

  it("reads PORT from the environment, as Railway injects it", () => {
    expect(loadConfig({ PORT: "3333" } as never).PORT).toBe(3333);
  });

  it("refuses a Tier 1 provider with no key", () => {
    expect(() => loadConfig({ EMAIL_VERIFY_PROVIDER: "abstract" } as never)).toThrow(
      /EMAIL_VERIFY_API_KEY/,
    );
  });

  it("refuses thresholds that cross over", () => {
    expect(() =>
      loadConfig({
        SCORE_VALID_THRESHOLD: "40",
        SCORE_SUSPICIOUS_THRESHOLD: "70",
      } as never),
    ).toThrow(/below/);
  });
});
