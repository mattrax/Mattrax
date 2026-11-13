import { describe, expect, it } from "vitest";
import { chord, matchesChord, shortcutLabel } from "./commands";

const event = (
  overrides: Partial<
    Record<"key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean | string>
  > = {},
) => ({
  key: "s",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("command shortcuts", () => {
  it("matches mod on meta or control and respects the other modifiers", () => {
    const save = chord("s", { mod: true });
    expect(matchesChord(save, event({ metaKey: true }) as any)).toBe(true);
    expect(matchesChord(save, event({ ctrlKey: true }) as any)).toBe(true);
    expect(matchesChord(save, event({ metaKey: true, shiftKey: true }) as any)).toBe(false);
    expect(matchesChord(save, event({ metaKey: true, altKey: true }) as any)).toBe(false);
    expect(matchesChord(save, event({}) as any)).toBe(false);
  });

  it("formats chords and sequences for the palette", () => {
    expect(shortcutLabel({ kind: "sequence", keys: ["g", "d"] })).toBe("G then D");
    expect(shortcutLabel(chord("e", { mod: true, shift: true }))).toMatch(/E/);
    expect(shortcutLabel(chord("1", { alt: true }))).toMatch(/1/);
  });
});
