/** Minimal shape the column helpers need from {@link MdmColumn}. */
export type ToggleableColumn = { readonly id: string };

/**
 * Compute the next controlled visible-column ids for one checkbox toggle.
 *
 * The result is always derived from the externally owned id list, never from
 * the table's internal declaration defaults: a saved view must keep columns it
 * already selected when one more is toggled. Newly enabled columns stay in
 * declaration order.
 */
export const toggleVisibleColumnIds = (
  columns: ReadonlyArray<ToggleableColumn>,
  current: ReadonlyArray<string>,
  columnId: string,
  visible: boolean,
): string[] =>
  columns.flatMap((column) =>
    column.id === columnId
      ? visible
        ? [column.id]
        : []
      : current.includes(column.id)
        ? [column.id]
        : [],
  );
