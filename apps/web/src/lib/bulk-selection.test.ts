import { describe, expect, it } from "vitest";
import {
  BULK_SELECTION_MAX,
  BulkSelectionTooLargeError,
  collectAllMatching,
} from "./bulk-selection";

const rows = (start: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `row-${start + index}`,
    name: `Row ${start + index}`,
  }));

describe("collectAllMatching", () => {
  it("walks pages until the reported total is collected", async () => {
    const all = rows(0, 450);
    const pages: Array<[number, number]> = [];

    const collected = await collectAllMatching(async (offset, limit) => {
      pages.push([offset, limit]);

      return { rows: all.slice(offset, offset + limit), total: all.length };
    });

    expect(collected.map((row) => row.id)).toEqual(all.map((row) => row.id));
    expect(pages).toEqual([
      [0, 200],
      [200, 200],
      [400, 200],
    ]);
  });

  it("deduplicates rows that move between pages while the filter is live", async () => {
    const collected = await collectAllMatching(async (offset, limit) => {
      const page = offset === 0 ? rows(0, 2) : rows(1, 2);

      return { rows: page.slice(0, limit), total: 3 };
    });

    expect(collected.map((row) => row.id)).toEqual(["row-0", "row-1", "row-2"]);
  });

  it("stops when the server returns an empty page", async () => {
    let calls = 0;

    const collected = await collectAllMatching(async () => {
      calls += 1;

      return { rows: [], total: 100 };
    });

    expect(collected).toEqual([]);
    expect(calls).toBe(1);
  });

  it("refuses a filter larger than the bulk cap instead of silently truncating", async () => {
    await expect(
      collectAllMatching(async () => ({ rows: [], total: BULK_SELECTION_MAX + 1 })),
    ).rejects.toBeInstanceOf(BulkSelectionTooLargeError);
  });
});
