export type DashboardLayout = { x: number; y: number; w: number; h: number };

const COLUMNS = 12;

/**
 * Widgets are normalised to integer cells in a twelve-column grid by the API.
 * A row stores the lowest occupied bottom in each column, so finding every
 * widget that overlaps a candidate costs at most `w * h` lookups instead of
 * scanning every widget already placed.
 */
type RowIndex = Map<number, Float64Array>;

const rowFor = (index: RowIndex, y: number): Float64Array => {
  let row = index.get(y);

  if (!row) {
    row = new Float64Array(COLUMNS).fill(-Infinity);
    index.set(y, row);
  }

  return row;
};

const blockerBottom = (index: RowIndex, layout: DashboardLayout): number | undefined => {
  let bottom: number | undefined;
  const firstColumn = Math.max(0, Math.trunc(layout.x));
  const lastColumn = Math.min(COLUMNS, Math.ceil(layout.x + layout.w));
  const firstRow = Math.max(0, Math.trunc(layout.y));
  const lastRow = Math.ceil(layout.y + layout.h);

  for (let y = firstRow; y < lastRow; y++) {
    const row = index.get(y);

    if (!row) continue;

    for (let x = firstColumn; x < lastColumn; x++) {
      const candidate = row[x]!;

      if (candidate === -Infinity) continue;
      bottom = bottom === undefined ? candidate : Math.max(bottom, candidate);
    }
  }

  return bottom;
};

const indexLayout = (index: RowIndex, layout: DashboardLayout): void => {
  const firstColumn = Math.max(0, Math.trunc(layout.x));
  const lastColumn = Math.min(COLUMNS, Math.ceil(layout.x + layout.w));
  const firstRow = Math.max(0, Math.trunc(layout.y));
  const lastRow = Math.ceil(layout.y + layout.h);
  const bottom = layout.y + layout.h;

  for (let y = firstRow; y < lastRow; y++) {
    const row = rowFor(index, y);

    for (let x = firstColumn; x < lastColumn; x++) row[x] = Math.max(row[x]!, bottom);
  }
};

/** Sort once per gesture; pointer moves reuse this order. */
export const orderDashboardLayout = (
  input: Readonly<Record<string, DashboardLayout>>,
  priorityId?: string,
): string[] =>
  Object.keys(input).sort((leftId, rightId) => {
    if (leftId === priorityId) return -1;
    if (rightId === priorityId) return 1;

    const left = input[leftId]!;
    const right = input[rightId]!;

    return left.y - right.y || left.x - right.x;
  });

/**
 * Push widgets down until a move or resize no longer overlaps them. The row
 * index is built as widgets are placed, preserving the original resolver's
 * ordering and hundred-collision guard without repeatedly scanning all placed
 * widgets.
 */
export const resolveDashboardLayout = (
  input: Readonly<Record<string, DashboardLayout>>,
  order: ReadonlyArray<string>,
  priority?: { id: string; layout: DashboardLayout },
) => {
  const placed: Record<string, DashboardLayout> = {};
  const index: RowIndex = new Map();

  for (const id of order) {
    const source = priority?.id === id ? priority.layout : input[id];

    if (!source) continue;

    const next = { ...source };

    for (let guard = 0; guard < 100; guard++) {
      const bottom = blockerBottom(index, next);

      if (bottom === undefined) break;
      next.y = bottom;
    }

    placed[id] = next;
    indexLayout(index, next);
  }

  return placed;
};

/** Capture the stable order and original positions for one drag gesture. */
export const createDashboardLayoutResolver = (
  input: Readonly<Record<string, DashboardLayout>>,
  priorityId?: string,
) => {
  const order = orderDashboardLayout(input, priorityId);

  return (priorityLayout: DashboardLayout) =>
    resolveDashboardLayout(
      input,
      order,
      priorityId ? { id: priorityId, layout: priorityLayout } : undefined,
    );
};
