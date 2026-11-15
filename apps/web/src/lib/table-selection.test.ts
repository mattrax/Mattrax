import { describe, expect, it } from "vitest";
import { shouldOfferAllMatching } from "./table-selection";

const base = {
  controlled: false,
  allMatching: false,
  allSelected: true,
  visible: 50,
  total: 240,
};

describe("shouldOfferAllMatching", () => {
  it("offers the rest of a server-paged result set", () => {
    expect(shouldOfferAllMatching(base)).toBe(true);
  });

  it("waits until every visible row is selected", () => {
    expect(shouldOfferAllMatching({ ...base, allSelected: false })).toBe(false);
  });

  it("does not repeat the offer once all-matching is active", () => {
    expect(shouldOfferAllMatching({ ...base, allMatching: true })).toBe(false);
  });

  it("treats client tables as already holding the whole result set", () => {
    expect(shouldOfferAllMatching({ ...base, total: 50 })).toBe(false);
    expect(shouldOfferAllMatching({ ...base, total: undefined })).toBe(false);
  });

  it("never offers a separate selection mode for controlled membership tables", () => {
    expect(shouldOfferAllMatching({ ...base, controlled: true })).toBe(false);
  });
});
