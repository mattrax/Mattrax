/** The API's device search caps a page at 200 rows. */
export const BULK_SELECTION_PAGE_SIZE = 200;

/**
 * A bulk action still fans out one request per row, so an unbounded "select all
 * matching" on a huge fleet would tie up the dashboard for minutes. The cap is
 * an explicit error rather than a silent partial selection.
 */
export const BULK_SELECTION_MAX = 10_000;

export class BulkSelectionTooLargeError extends Error {
  readonly count: number;
  readonly limit: number;

  constructor(count: number, limit: number) {
    super(
      `This filter matches ${count.toLocaleString()} rows. Bulk actions support up to ${limit.toLocaleString()} at a time; narrow the filter and try again.`,
    );
    this.name = "BulkSelectionTooLargeError";
    this.count = count;
    this.limit = limit;
  }
}

/**
 * Resolve every row a server-side filter matches by walking pages of the same
 * search endpoint the table uses. The server still scopes and authorises every
 * id when the action runs; this only turns "all matching" into the explicit id
 * list the bulk endpoints already accept.
 */
export async function collectAllMatching<T extends { id: string }>(
  page: (offset: number, limit: number) => Promise<{ rows: readonly T[]; total: number }>,
  options: { limit?: number; max?: number } = {},
): Promise<T[]> {
  const limit = options.limit ?? BULK_SELECTION_PAGE_SIZE;
  const max = options.max ?? BULK_SELECTION_MAX;
  const collected = new Map<string, T>();
  let total = Number.POSITIVE_INFINITY;
  let offset = 0;

  while (offset < total) {
    const result = await page(offset, limit);
    total = result.total;

    if (total > max) throw new BulkSelectionTooLargeError(total, max);

    if (result.rows.length === 0) break;

    for (const row of result.rows) collected.set(row.id, row);
    offset += result.rows.length;

    if (collected.size > max) throw new BulkSelectionTooLargeError(collected.size, max);
  }

  return [...collected.values()];
}
