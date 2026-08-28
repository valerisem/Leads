import { describe, expect, it } from "vitest";
import { DisposableDomainList } from "../src/lib/disposable.js";

describe("DisposableDomainList", () => {
  it("blocks known throwaway providers from the bundled seed list", () => {
    const list = new DisposableDomainList({ refreshHours: 24, offline: true });
    expect(list.has("mailinator.com")).toBe(true);
    expect(list.has("MAILINATOR.COM")).toBe(true);
    expect(list.has("acme-brands.com")).toBe(false);
  });

  it("merges a fetched blocklist over the seed list", async () => {
    const list = new DisposableDomainList({
      refreshHours: 24,
      fetchList: async (url) =>
        url.includes("allowlist")
          ? ""
          : ["# comment", ...Array.from({ length: 80 }, (_, i) => `junk${i}.com`)].join("\n"),
    });
    await list.ensureFresh();
    expect(list.has("junk7.com")).toBe(true);
    expect(list.has("mailinator.com")).toBe(true); // seed survives the merge
  });

  it("lets the allowlist rescue a false positive", async () => {
    const list = new DisposableDomainList({
      refreshHours: 24,
      fetchList: async (url) =>
        url.includes("allowlist")
          ? "realcompany.com"
          : ["realcompany.com", ...Array.from({ length: 80 }, (_, i) => `junk${i}.com`)].join("\n"),
    });
    await list.ensureFresh();
    expect(list.has("realcompany.com")).toBe(false);
  });

  it("keeps the previous list when the fetch returns something implausibly small", async () => {
    const list = new DisposableDomainList({
      refreshHours: 24,
      fetchList: async () => "onlyone.com",
    });
    await list.ensureFresh();
    expect(list.has("mailinator.com")).toBe(true);
    expect(list.has("onlyone.com")).toBe(false);
  });

  it("survives a failing fetch", async () => {
    const list = new DisposableDomainList({
      refreshHours: 24,
      fetchList: async () => {
        throw new Error("network down");
      },
    });
    await expect(list.ensureFresh()).resolves.toBeUndefined();
    expect(list.has("mailinator.com")).toBe(true);
  });
});
