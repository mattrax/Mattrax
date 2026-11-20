import { describe, expect, it } from "vitest";
import {
  ENTITY_LIST_DEFAULT_LIMIT,
  ENTITY_LIST_MAX_LIMIT,
  normalizeEntityListQuery,
} from "../src/Search/entityList.ts";

const SORTS = ["name", "priority", "updatedAt"] as const;

const FIELDS = [
  { id: "name", kind: "text" as const },
  { id: "priority", kind: "number" as const },
];

describe("normalizeEntityListQuery", () => {
  it("defaults to a bounded first page in the entity's first sort order", () => {
    expect(normalizeEntityListQuery({}, SORTS, FIELDS)).toEqual({
      q: undefined,
      conditions: [],
      limit: ENTITY_LIST_DEFAULT_LIMIT,
      offset: 0,
      sort: "name",
      direction: "asc",
    });
  });

  it("clamps hostile page sizes and negative offsets", () => {
    expect(normalizeEntityListQuery({ limit: 10_000 }, SORTS, FIELDS).limit).toBe(
      ENTITY_LIST_MAX_LIMIT,
    );
    expect(normalizeEntityListQuery({ limit: 0 }, SORTS, FIELDS).limit).toBe(1);
    expect(normalizeEntityListQuery({ limit: -5 }, SORTS, FIELDS).limit).toBe(1);
    expect(normalizeEntityListQuery({ offset: -20 }, SORTS, FIELDS).offset).toBe(0);
    expect(normalizeEntityListQuery({ offset: 12.9 }, SORTS, FIELDS).offset).toBe(12);
  });

  it("accepts query-string numbers, because HTTP hands every page value over as text", () => {
    expect(normalizeEntityListQuery({ limit: "25", offset: "50" }, SORTS, FIELDS)).toMatchObject({
      limit: 25,
      offset: 50,
    });
  });

  it("keeps a requested sort and direction", () => {
    expect(
      normalizeEntityListQuery({ sort: "priority", direction: "desc" }, SORTS, FIELDS),
    ).toMatchObject({ sort: "priority", direction: "desc" });
  });

  it("trims the free-text search and treats whitespace as absent", () => {
    expect(normalizeEntityListQuery({ q: "  alpha  " }, SORTS, FIELDS).q).toBe("alpha");
    expect(normalizeEntityListQuery({ q: "   " }, SORTS, FIELDS).q).toBeUndefined();
  });

  it("parses the shareable filter text and drops fields this list cannot filter", () => {
    expect(
      normalizeEntityListQuery(
        { query: "name contains alpha and priority at least 2 and nope is 1" },
        SORTS,
        FIELDS,
      ).conditions,
    ).toEqual([
      { field: "name", op: "contains", value: "alpha" },
      { field: "priority", op: "at least", value: "2" },
    ]);
  });
});
