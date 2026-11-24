import { describe, expect, it } from "vitest";
import {
  beginCisApply,
  beginCisLoad,
  cisApplyLabel,
  cisDialogLoading,
  cisDialogPending,
  cisLoadingLabel,
  finishCisApply,
  finishCisLoad,
  initialCisDialogActivity,
  toggleCisControlSelection,
} from "./cis-dialog";

describe("CIS dialog activity", () => {
  it("keeps overlapping loads active until the last one finishes", () => {
    // Opening the dialog starts the index load; choosing the first benchmark
    // starts a template load before the index request settles.
    let state = beginCisLoad(initialCisDialogActivity);
    state = beginCisLoad(state);
    expect(cisDialogLoading(state)).toBe(true);

    state = finishCisLoad(state);
    expect(cisDialogLoading(state)).toBe(true);

    state = finishCisLoad(state);
    expect(cisDialogLoading(state)).toBe(false);
  });

  it("does not show submitting state while controls are only being selected", () => {
    let selected: ReadonlySet<string> = new Set();
    const state = initialCisDialogActivity;

    for (let index = 0; index < 30; index += 1) {
      selected = toggleCisControlSelection(selected, `control-${index}`);
    }

    expect(selected.size).toBe(30);
    expect(cisDialogPending(state)).toBe(false);
    expect(cisApplyLabel(state)).toBe("Apply selected controls");
    expect(cisLoadingLabel(state, "Choose a benchmark to see its controls.")).toBe(
      "Choose a benchmark to see its controls.",
    );
  });

  it("labels loading and applying distinctly", () => {
    const loading = beginCisLoad(initialCisDialogActivity);

    expect(cisLoadingLabel(loading, "Choose a benchmark")).toBe("Loading benchmark…");
    expect(cisApplyLabel(loading)).toBe("Apply selected controls");

    const applying = beginCisApply(loading);

    expect(cisDialogPending(applying)).toBe(true);
    expect(cisApplyLabel(applying)).toBe("Applying…");

    // Finishing the underlying load must not clear the submission state.
    const finishedLoad = finishCisLoad(applying);
    expect(cisDialogPending(finishedLoad)).toBe(true);
    expect(cisDialogPending(finishCisApply(finishedLoad))).toBe(false);
  });

  it("toggles a control off without touching the activity state", () => {
    const selected = toggleCisControlSelection(new Set(["1.1", "1.2"]), "1.2");
    const state = initialCisDialogActivity;

    expect([...selected]).toEqual(["1.1"]);
    expect(cisDialogPending(state)).toBe(false);
  });
});
