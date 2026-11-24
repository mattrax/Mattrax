import { describe, expect, it } from "vitest";
import { cisDialogPending, toggleCisControlSelection } from "./cis-dialog";

describe("CIS dialog pending state", () => {
  it("stays idle while controls are only being selected", () => {
    let selected: ReadonlySet<string> = new Set();

    for (let index = 0; index < 30; index += 1) {
      selected = toggleCisControlSelection(selected, `control-${index}`);
    }

    expect(selected.size).toBe(30);
    expect(cisDialogPending({ applying: false })).toBe(false);
  });

  it("is pending only while the selection is being applied", () => {
    expect(cisDialogPending({ applying: true })).toBe(true);
    expect(cisDialogPending({ applying: false })).toBe(false);
  });

  it("toggles a control off without touching the pending flag", () => {
    const selected = toggleCisControlSelection(new Set(["1.1", "1.2"]), "1.2");

    expect([...selected]).toEqual(["1.1"]);
    expect(cisDialogPending({ applying: false })).toBe(false);
  });
});
