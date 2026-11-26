import { describe, expect, it } from "vitest";
import {
  beginCisApply,
  beginCisIndexLoad,
  beginCisLoad,
  cisApplyLabel,
  cisDialogLoading,
  cisDialogPending,
  cisLoadingLabel,
  createCisRequestGate,
  finishCisApply,
  finishCisLoad,
  initialCisDialogActivity,
  initialCisIndexState,
  rejectCisIndexLoad,
  resolveCisIndexLoad,
  toggleCisControlSelection,
} from "./cis-dialog";
import type { CisTemplateSummary } from "./cis";

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

describe("CIS benchmark request ordering", () => {
  it("ignores a slow earlier benchmark that settles after a later choice", async () => {
    const request = createCisRequestGate();
    const pending = () => {
      let resolve!: (value: string) => void;
      const promise = new Promise<string>((settle) => {
        resolve = settle;
      });

      return { promise, resolve };
    };
    let applied: string | undefined;

    // Mirrors `choose`: start a request, then write only while its token is
    // still the newest. The old dialog wrote on every completion, so the slow
    // first response would land last and overwrite the later benchmark.
    const apply = async (value: Promise<string>) => {
      const token = request.begin();
      const loaded = await value;

      if (request.isCurrent(token)) applied = loaded;
    };

    const slow = pending();
    const fast = pending();
    const first = apply(slow.promise);
    const second = apply(fast.promise);

    fast.resolve("windows");
    await second;
    slow.resolve("apple");
    await first;

    expect(applied).toBe("windows");
  });

  it("treats every request as stale after the selection is cleared", () => {
    const request = createCisRequestGate();
    const token = request.begin();

    expect(request.isCurrent(token)).toBe(true);

    request.begin();

    expect(request.isCurrent(token)).toBe(false);
  });
});

describe("CIS benchmark index state", () => {
  const summary: CisTemplateSummary = {
    id: "apple-benchmark",
    platform: "apple",
    benchmark: { name: "Apple", version: "1.0", source: "https://example.com" },
    description: "A benchmark.",
    stats: { controls: 1, mapped: 1, settings: 1 },
    file: "apple-benchmark.json",
  };

  it("clears a failure when a retry starts and when a load succeeds", () => {
    let state = rejectCisIndexLoad(initialCisIndexState, "Network unavailable");
    expect(state.error).toBe("Network unavailable");

    // A retry starts: the stale banner must not sit in front of the spinner.
    state = beginCisIndexLoad(state);
    expect(state.error).toBeUndefined();

    state = rejectCisIndexLoad(state, "Network unavailable");
    state = resolveCisIndexLoad(state, [summary]);

    expect(state.error).toBeUndefined();
    expect(state.templates).toEqual([summary]);
  });
});
