import { describe, expect, it } from "vitest";
import { commandStatusTone, isActiveCommandStatus, mergeActivityPages } from "./device-activity";

const entry = (id: string, at: string) => ({
  id,
  kind: "audit" as const,
  title: id,
  detail: null,
  status: null,
  at,
});

describe("commandStatusTone", () => {
  it("gives every lifecycle status a badge tone", () => {
    expect(commandStatusTone("queued")).toBe("muted");
    expect(commandStatusTone("sent")).toBe("brand");
    expect(commandStatusTone("deferred")).toBe("warning");
    expect(commandStatusTone("succeeded")).toBe("success");
    expect(commandStatusTone("failed")).toBe("danger");
    expect(commandStatusTone("expired")).toBe("warning");
    expect(commandStatusTone("superseded")).toBe("muted");
    expect(commandStatusTone("cancelled")).toBe("muted");
    expect(commandStatusTone("unknown")).toBe("muted");
  });
});

describe("isActiveCommandStatus", () => {
  it("only counts statuses the device can still run", () => {
    expect(isActiveCommandStatus("queued")).toBe(true);
    expect(isActiveCommandStatus("sent")).toBe(true);
    expect(isActiveCommandStatus("deferred")).toBe(true);
    expect(isActiveCommandStatus("succeeded")).toBe(false);
    expect(isActiveCommandStatus("failed")).toBe(false);
    expect(isActiveCommandStatus("expired")).toBe(false);
    expect(isActiveCommandStatus("superseded")).toBe(false);
    expect(isActiveCommandStatus("cancelled")).toBe(false);
    expect(isActiveCommandStatus("unknown")).toBe(false);
  });
});

describe("mergeActivityPages", () => {
  it("keeps page order and drops rows repeated by a shifted page", () => {
    const merged = mergeActivityPages([
      { events: [entry("a", "2026-01-03T00:00:00.000Z"), entry("b", "2026-01-02T00:00:00.000Z")] },
      { events: [entry("b", "2026-01-02T00:00:00.000Z"), entry("c", "2026-01-01T00:00:00.000Z")] },
    ]);

    expect(merged.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty feed before the first page arrives", () => {
    expect(mergeActivityPages(undefined)).toEqual([]);
  });
});
