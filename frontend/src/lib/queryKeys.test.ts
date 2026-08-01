import { describe, expect, it } from "vitest";
import { adminFamilies, adminReviewQueue, familyMe, pendingFamilies, referrerFamilies, referrerMe, referrerReviewQueue } from "./queryKeys";

describe("query keys are stable arrays", () => {
  it("has correct auth key", () => {
    expect(familyMe).toEqual(["familyMe"]);
  });

  it("has correct referrer keys", () => {
    expect(referrerMe).toEqual(["referrerMe"]);
    expect(referrerFamilies).toEqual(["referrerFamilies"]);
    expect(pendingFamilies).toEqual(["pendingFamilies"]);
    expect(referrerReviewQueue).toEqual(["referrerReviewQueue"]);
  });

  it("has correct admin keys", () => {
    expect(adminFamilies).toEqual(["adminFamilies"]);
    expect(adminReviewQueue).toEqual(["adminReviewQueue"]);
  });
});
