import type { CisTemplateSummary } from "./cis";

/**
 * State helpers for the CIS benchmark dialog.
 *
 * Loading the benchmark index, loading a selected benchmark and applying a
 * selection are separate operations. The old dialog shared one boolean, so the
 * outer index load's finally block could clear the pending state while a
 * template request was still running. The counter keeps overlapping loads
 * distinct, and only `applying` counts as a submission.
 */
export type CisDialogActivity = {
  /** Number of benchmark/template requests in flight. */
  readonly loadingCount: number;
  /** True only while "Apply selected controls" is submitting. */
  readonly applying: boolean;
};

export const initialCisDialogActivity: CisDialogActivity = { loadingCount: 0, applying: false };

export const beginCisLoad = (state: CisDialogActivity): CisDialogActivity => ({
  ...state,
  loadingCount: state.loadingCount + 1,
});

export const finishCisLoad = (state: CisDialogActivity): CisDialogActivity => ({
  ...state,
  loadingCount: Math.max(0, state.loadingCount - 1),
});

export const beginCisApply = (state: CisDialogActivity): CisDialogActivity => ({
  ...state,
  applying: true,
});

export const finishCisApply = (state: CisDialogActivity): CisDialogActivity => ({
  ...state,
  applying: false,
});

export const cisDialogLoading = (state: CisDialogActivity): boolean => state.loadingCount > 0;

export const cisDialogPending = (state: CisDialogActivity): boolean => state.applying;

/** The Apply button label; selection alone can never produce "Applying…". */
export const cisApplyLabel = (state: CisDialogActivity): string =>
  state.applying ? "Applying…" : "Apply selected controls";

/** The list/empty-state label, distinct from the Apply label. */
export const cisLoadingLabel = (state: CisDialogActivity, idle: string): string =>
  cisDialogLoading(state) ? "Loading benchmark…" : idle;

/**
 * Order benchmark loads so only the newest choice may write its result.
 *
 * The picker stays interactive between choices; a slow request for the
 * previous benchmark can settle after the administrator has already picked a
 * different one. Without a token both responses write the template, and the
 * dialog ends up showing (and applying) the wrong benchmark.
 */
export type CisRequestGate = {
  /** Start a request and receive its token. */
  readonly begin: () => number;
  /** True while the token belongs to the newest started request. */
  readonly isCurrent: (token: number) => boolean;
};

export const createCisRequestGate = (): CisRequestGate => {
  let latest = 0;

  return {
    begin: () => {
      latest += 1;

      return latest;
    },
    isCurrent: (token) => token === latest,
  };
};

/**
 * The benchmark index and its failure belong together. Clearing the failure
 * when a retry starts (and when it succeeds) keeps the error banner from
 * outliving the problem and hiding a list that did load.
 */
export type CisIndexState = {
  readonly templates?: ReadonlyArray<CisTemplateSummary>;
  readonly error?: string;
};

export const initialCisIndexState: CisIndexState = {};

export const beginCisIndexLoad = (state: CisIndexState): CisIndexState => ({
  ...state,
  error: undefined,
});

export const resolveCisIndexLoad = (
  state: CisIndexState,
  templates: ReadonlyArray<CisTemplateSummary>,
): CisIndexState => ({
  ...state,
  templates: [...templates],
  error: undefined,
});

export const rejectCisIndexLoad = (state: CisIndexState, error: string): CisIndexState => ({
  ...state,
  error,
});

export const toggleCisControlSelection = (
  selected: ReadonlySet<string>,
  controlId: string,
): ReadonlySet<string> => {
  const next = new Set(selected);

  if (next.has(controlId)) next.delete(controlId);
  else next.add(controlId);

  return next;
};
