import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SCRIPT_LANGUAGE_OPTIONS,
  SCRIPT_RUN_AS_OPTIONS,
  SCRIPT_TRIGGER_OPTIONS,
} from "./script-editor-options";

const componentSource = readFileSync(
  new URL("../components/mdm/script-editor.tsx", import.meta.url),
  "utf8",
);

describe("script editor selects", () => {
  it("uses the design-system Select rather than native selects", () => {
    expect(componentSource).not.toMatch(/<select\b/);
    expect(componentSource).toContain("SelectTrigger");
    expect(componentSource).toContain("SelectContent");
    expect(componentSource).toContain("SelectItem");
    expect(componentSource).toContain('aria-label="Shell"');
    expect(componentSource).toContain('aria-label="Run as"');
    expect(componentSource).toContain('aria-label="Schedule"');
  });

  it("keeps a label for every supported shell", () => {
    expect(SCRIPT_LANGUAGE_OPTIONS.map((option) => option.value)).toEqual([
      "bash",
      "zsh",
      "sh",
      "pwsh",
    ]);
    expect(SCRIPT_LANGUAGE_OPTIONS.every((option) => option.label.trim().length > 0)).toBe(true);
  });

  it("keeps a label for every run-as mode and schedule", () => {
    expect(SCRIPT_RUN_AS_OPTIONS.map((option) => option.value)).toEqual(["user", "root"]);
    expect(SCRIPT_TRIGGER_OPTIONS.map((option) => option.value)).toEqual([
      "manual",
      "install",
      "login",
      "logout",
      "network-change",
      "interval",
      "cron",
    ]);
    expect(SCRIPT_TRIGGER_OPTIONS.every((option) => option.label.trim().length > 0)).toBe(true);
  });
});
