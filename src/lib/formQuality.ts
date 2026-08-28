import type { LeadInput, Signal } from "./types.js";

/**
 * Answers that carry no information. Every DNS check can pass while the
 * submission itself is plainly junk — "idk", "test", "asdf".
 */
const EMPTY_ANSWERS = new Set([
  "idk", "i dont know", "i don't know", "dunno", "n/a", "na", "none", "no",
  "nothing", "-", "--", ".", "..", "...", "?", "??", "test", "testing",
  "asdf", "asdfasdf", "qwerty", "hi", "hello", "hey", "help", "tbc", "tbd",
  "info", "more info", "details", "x", "xx", "abc", "123", "aaa",
]);

const MIN_MESSAGE_LENGTH = 15;

/** Budget bands that read as the bottom of the range, lowercased. */
const LOW_BUDGET_MARKERS = ["below", "under", "less than", "< ", "<$"];

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strips punctuation so "idk." and "idk!" score the same as "idk". */
function stripPunctuation(value: string): string {
  return value.replace(/[.!?,;:'"]+/g, "").trim();
}

export function assessFormQuality(input: LeadInput): Signal[] {
  const signals: Signal[] = [];

  const fullName = normalize(input.fullName);
  const companyName = normalize(input.companyName);
  const message = normalize(input.message);
  const budget = normalize(input.budget);

  // A company field that just repeats the person's own name is the single
  // clearest tell of a consumer filling in a B2B form.
  if (companyName && fullName) {
    const nameParts = fullName.split(" ").filter(Boolean);
    const companyIsJustAName =
      nameParts.includes(companyName) || companyName === fullName;
    if (companyIsJustAName) {
      signals.push({
        code: "company_name_is_person_name",
        label: `Company name "${input.companyName}" is just the contact's own name`,
        severity: "major",
        weight: 20,
      });
    }
  }

  if (!companyName) {
    signals.push({
      code: "company_name_missing",
      label: "No company name given",
      severity: "major",
      weight: 15,
    });
  }

  if (!message) {
    signals.push({
      code: "message_missing",
      label: "No enquiry text given",
      severity: "minor",
      weight: 10,
    });
  } else {
    const stripped = stripPunctuation(message);
    if (EMPTY_ANSWERS.has(stripped)) {
      signals.push({
        code: "message_no_information",
        label: `Enquiry text "${input.message}" says nothing about the need`,
        severity: "major",
        weight: 15,
      });
    } else if (stripped.length < MIN_MESSAGE_LENGTH) {
      signals.push({
        code: "message_very_short",
        label: `Enquiry text is only ${stripped.length} characters`,
        severity: "minor",
        weight: 8,
      });
    } else if (stripped.length > 120) {
      signals.push({
        code: "message_detailed",
        label: "Enquiry text is detailed",
        severity: "positive",
        weight: -5,
      });
    }
  }

  if (fullName && !fullName.includes(" ")) {
    signals.push({
      code: "full_name_single_word",
      label: "Contact gave only one name",
      severity: "minor",
      weight: 5,
    });
  }

  if (budget && LOW_BUDGET_MARKERS.some((marker) => budget.includes(marker))) {
    signals.push({
      code: "budget_lowest_band",
      label: `Budget is the lowest band (${input.budget})`,
      severity: "minor",
      weight: 5,
    });
  }

  if (!normalize(input.phone)) {
    signals.push({
      code: "phone_missing",
      label: "No phone number given",
      severity: "minor",
      weight: 3,
    });
  }

  return signals;
}
