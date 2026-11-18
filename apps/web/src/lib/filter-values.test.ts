import { describe, expect, it } from "vitest";
import {
  firstFilterValue,
  formatFilterValues,
  isMultiFilterValue,
  normaliseFilterOperatorValues,
  normaliseFilterValues,
  normaliseNumericFilterValues,
  quoteFilterValue,
  splitFilterValues,
  unquoteFilterValue,
} from "@mattrax/ui/filter-values";

describe("quoteFilterValue", () => {
  it("leaves simple values alone", () => {
    expect(quoteFilterValue("Alpha")).toBe("Alpha");
  });

  it("quotes whitespace, commas, quotes and backslashes", () => {
    expect(quoteFilterValue("Alpha Beta")).toBe('"Alpha Beta"');
    expect(quoteFilterValue("a,b")).toBe('"a,b"');
    expect(quoteFilterValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteFilterValue("C:\\Users\\Admin")).toBe('"C:\\\\Users\\\\Admin"');
  });
});

describe("unquoteFilterValue", () => {
  it("returns unquoted values untouched", () => {
    expect(unquoteFilterValue("Alpha")).toBe("Alpha");
  });

  it("resolves escaped quotes and backslashes", () => {
    expect(unquoteFilterValue('"say \\"hi\\""')).toBe('say "hi"');
    expect(unquoteFilterValue('"C:\\\\Temp"')).toBe("C:\\Temp");
  });

  it("keeps unknown escapes literal instead of eating the value", () => {
    expect(unquoteFilterValue('"C:\\Temp"')).toBe("C:\\Temp");
  });
});

describe("splitFilterValues", () => {
  it("splits and trims a plain list", () => {
    expect(splitFilterValues(" Alpha , Beta ,  Gamma ")).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("keeps commas inside quotes", () => {
    expect(splitFilterValues('"ACME, Inc", Beta')).toEqual(["ACME, Inc", "Beta"]);
  });

  it("does not let an escaped quote swallow the rest of the list", () => {
    expect(splitFilterValues('"say \\"hi\\"", Beta')).toEqual(['say "hi"', "Beta"]);
  });

  it("keeps a Windows path as one value", () => {
    expect(splitFilterValues('"C:\\\\Users\\\\Admin", Beta')).toEqual(["C:\\Users\\Admin", "Beta"]);
  });

  it("keeps a trailing backslash", () => {
    expect(splitFilterValues('"C:\\\\Temp\\\\", Beta')).toEqual(["C:\\Temp\\", "Beta"]);
  });

  it("drops empty entries", () => {
    expect(splitFilterValues(" , Alpha, , ")).toEqual(["Alpha"]);
    expect(splitFilterValues("")).toEqual([]);
  });
});

describe("round-trips", () => {
  it("preserves paths, commas, quotes and spaces", () => {
    const values = ["C:\\Users\\Admin", "Alpha Beta", "a,b", 'say "hi"', "ends\\"];

    expect(splitFilterValues(formatFilterValues(values))).toEqual(values);
  });
});

describe("normaliseNumericFilterValues", () => {
  it("drops junk and canonicalises finite numbers", () => {
    expect(normaliseNumericFilterValues(["03", "nope", "1e2", "", " 7 ", "NaN"])).toEqual([
      "3",
      "100",
      "7",
    ]);
  });

  it("deduplicates canonical duplicates", () => {
    expect(normaliseNumericFilterValues(["1", "01", "1.0"])).toEqual(["1"]);
  });

  it("keeps an empty list empty", () => {
    expect(normaliseNumericFilterValues([])).toEqual([]);
    expect(normaliseNumericFilterValues(["junk"])).toEqual([]);
  });
});

describe("firstFilterValue", () => {
  it("keeps only the first usable value", () => {
    expect(firstFilterValue(["", "Alpha", "Beta"])).toEqual(["Alpha"]);
    expect(firstFilterValue([])).toEqual([]);
  });
});

describe("operator value normalisation", () => {
  it("treats in and explicit multi-select fields as list operators", () => {
    expect(isMultiFilterValue({ kind: "text" }, "in")).toBe(true);
    expect(isMultiFilterValue({ kind: "select" }, "in")).toBe(true);
    expect(isMultiFilterValue({ kind: "select", multiple: true }, "is")).toBe(true);
    expect(isMultiFilterValue({ kind: "select" }, "is")).toBe(false);
  });

  it("truncates to the first value when leaving a list operator", () => {
    expect(normaliseFilterOperatorValues({ kind: "text" }, "is", ["Alpha", "Beta"])).toEqual([
      "Alpha",
    ]);
    expect(normaliseFilterOperatorValues({ kind: "number" }, "at least", ["3", "10"])).toEqual([
      "3",
    ]);
  });

  it("keeps values when moving to a list operator", () => {
    expect(normaliseFilterOperatorValues({ kind: "text" }, "in", ["Alpha", "Beta"])).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("normalises numeric lists but leaves text lists alone", () => {
    expect(normaliseFilterValues({ kind: "number" }, "in", ["03", "junk", "10"])).toEqual([
      "3",
      "10",
    ]);
    expect(normaliseFilterValues({ kind: "text" }, "in", ["03", "junk"])).toEqual(["03", "junk"]);
  });
});
