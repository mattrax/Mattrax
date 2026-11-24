/**
 * State helpers for the CIS benchmark dialog.
 *
 * Selecting a control is local UI state. It must never make the dialog look
 * like it is submitting, so the pending predicate only reads the `applying`
 * flag owned by the "Apply selected controls" action.
 */
export type CisDialogActivity = {
  readonly applying: boolean;
};

export const cisDialogPending = (activity: CisDialogActivity): boolean => activity.applying;

export const toggleCisControlSelection = (
  selected: ReadonlySet<string>,
  controlId: string,
): ReadonlySet<string> => {
  const next = new Set(selected);

  if (next.has(controlId)) next.delete(controlId);
  else next.add(controlId);

  return next;
};
