import { describe, expect, test } from "vitest";
import { newErrorReference } from "./error-reference";

describe("error references", () => {
  test("are short, prefixed and quotable", () => {
    const reference = newErrorReference();

    expect(reference).toMatch(/^ERR-[0-9A-F]{8}$/);
  });

  test("do not repeat", () => {
    const references = new Set(Array.from({ length: 50 }, () => newErrorReference()));

    expect(references.size).toBe(50);
  });
});
