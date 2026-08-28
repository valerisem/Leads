import { describe, expect, it } from "vitest";
import { parseEmail } from "../src/lib/email.js";

describe("parseEmail", () => {
  it("splits a normal address", () => {
    expect(parseEmail("Alexandra.Mus@iCloud.com")).toEqual({
      address: "alexandra.mus@icloud.com",
      localPart: "alexandra.mus",
      domain: "icloud.com",
    });
  });

  it("unwraps a display-name form", () => {
    expect(parseEmail("Alexandra Musorin <a.mus@acme.co.uk>")?.domain).toBe("acme.co.uk");
  });

  it.each([
    ["", "empty"],
    [null, "null"],
    ["not-an-email", "no @"],
    ["a@b", "no TLD"],
    ["a@@b.com", "double @"],
    ["a b@c.com", "space in local part"],
    ["a@b..com", "double dot in domain"],
    [".a@b.com", "leading dot"],
    ["a.@b.com", "trailing dot"],
  ])("rejects %j (%s)", (input) => {
    expect(parseEmail(input as string | null)).toBeNull();
  });

  it("rejects an over-long address", () => {
    expect(parseEmail(`${"a".repeat(250)}@b.com`)).toBeNull();
  });

  it("accepts plus addressing and hyphenated domains", () => {
    expect(parseEmail("jo+leads@house-of-marketers.com")?.localPart).toBe("jo+leads");
  });
});
