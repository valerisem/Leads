import { describe, expect, it } from "vitest";
import { parseWebsite, sameSite } from "../src/lib/website.js";

describe("parseWebsite", () => {
  it.each([
    ["acme.com", "acme.com"],
    ["www.acme.com", "acme.com"],
    ["https://acme.com/about?x=1", "acme.com"],
    ["  HTTPS://WWW.Acme.co.uk/  ", "acme.co.uk"],
  ])("parses %j into %j", (input, expected) => {
    expect(parseWebsite(input)?.hostname).toBe(expected);
  });

  it.each([
    ["url", "the literal placeholder from the sample form"],
    ["n/a", "not applicable"],
    ["-", "dash"],
    ["", "empty"],
    [null, "null"],
    ["idk", "no idea"],
    ["a@b.com", "an email address pasted into the website field"],
    ["just some words", "prose"],
    ["example.com", "documentation placeholder"],
  ])("rejects %j (%s)", (input) => {
    expect(parseWebsite(input as string | null)).toBeNull();
  });
});

describe("sameSite", () => {
  it("ignores a www prefix", () => {
    expect(sameSite("www.acme.com", "acme.com")).toBe(true);
  });
  it("distinguishes different hosts", () => {
    expect(sameSite("acme.com", "acme.co.uk")).toBe(false);
  });
});
