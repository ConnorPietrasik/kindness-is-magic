import { describe, expect, it } from "vitest";
import type { ThankYouDonor } from "../types";
import { buildThankYouDraft } from "./thankYouDraft";

const BASE: ThankYouDonor = {
  email: "donor@test.com",
  display_name: null,
  source: "claims",
  claim_count: 0,
  claim_family_names: [],
  latest_fulfilled_at: null,
  general_payment_count: 0,
  general_total_cents: 0,
  latest_donation_at: null,
  thanked_at: null,
  thanked_by_name: null,
};

describe("buildThankYouDraft", () => {
  it("greets by first name and confirms a single sponsorship without naming the family", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      display_name: "Ada Lovelace",
      source: "claims",
      claim_count: 1,
      claim_family_names: ["The Adams"],
    });
    expect(draft.subject).toBe("Thank you, Ada, for your sponsorship");
    expect(draft.message).toContain("Hi Ada,");
    expect(draft.message).toContain("your sponsorship");
    expect(draft.message).toContain("The family has received all their gifts");
    // Family names are PII and must never reach the donor
    expect(draft.message).not.toContain("The Adams");
  });

  it("falls back to a neutral greeting without a name", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      source: "claims",
      claim_count: 1,
      claim_family_names: ["The Adams"],
    });
    expect(draft.subject).toBe("Thank you for your sponsorship");
    expect(draft.message).toContain("Hi there,");
  });

  it("uses the plural for multiple sponsorships without naming the families", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      source: "claims",
      claim_count: 2,
      claim_family_names: ["The Adams", "The Bells"],
    });
    expect(draft.message).toContain("your sponsorships");
    expect(draft.message).toContain("The families have all received their gifts");
    expect(draft.message).not.toContain("The Adams");
    expect(draft.message).not.toContain("The Bells");
  });

  it("general donors get the total, not family names", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      display_name: "Gil Giver",
      source: "general",
      general_payment_count: 1,
      general_total_cents: 50_000,
    });
    expect(draft.subject).toBe("Thank you, Gil, for your donation");
    expect(draft.message).toContain("$500 donation to Kindness Is Magic");
    expect(draft.message).not.toContain("family");
  });

  it("aggregates multiple general donations", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      source: "general",
      general_payment_count: 2,
      general_total_cents: 12_500,
    });
    expect(draft.message).toContain("donations to Kindness Is Magic ($125 in total)");
  });

  it("keeps cents on non-whole amounts", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      source: "general",
      general_payment_count: 1,
      general_total_cents: 9_950,
    });
    expect(draft.message).toContain("$99.50");
  });

  it("combines both sides for a 'both' donor", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      display_name: "Beth Both",
      source: "both",
      claim_count: 1,
      claim_family_names: ["The Beths"],
      general_payment_count: 1,
      general_total_cents: 40_000,
    });
    expect(draft.subject).toBe("Thank you, Beth, for your generosity");
    expect(draft.message).toContain("your sponsorship");
    expect(draft.message).toContain("$400 donation to Kindness Is Magic");
    expect(draft.message).not.toContain("The Beths");
  });

  it("ends with the program sign-off", () => {
    const draft = buildThankYouDraft({
      ...BASE,
      source: "general",
      general_payment_count: 1,
      general_total_cents: 10_000,
    });
    expect(draft.message).toContain("The Kindness Is Magic team");
  });
});
