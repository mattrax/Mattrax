import { describe, expect, it } from "vitest";
import {
  createDashboardLayoutResolver,
  orderDashboardLayout,
  resolveDashboardLayout,
} from "./dashboard-layout";
import type { DashboardLayout } from "./dashboard-layout";

const overlaps = (left: DashboardLayout, right: DashboardLayout) =>
  left.x < right.x + right.w &&
  left.x + left.w > right.x &&
  left.y < right.y + right.h &&
  left.y + left.h > right.y;

/** The pre-optimisation resolver, kept as the behavioural oracle. */
const referenceResolve = (input: Record<string, DashboardLayout>, priorityId?: string) => {
  const placed: Record<string, DashboardLayout> = {};
  const ordered = Object.entries(input).sort(([leftId, left], [rightId, right]) => {
    if (leftId === priorityId) return -1;
    if (rightId === priorityId) return 1;

    return left.y - right.y || left.x - right.x;
  });

  for (const [id, layout] of ordered) {
    const next = { ...layout };

    for (let guard = 0; guard < 100; guard++) {
      const blockers = Object.values(placed).filter((other) => overlaps(next, other));

      if (blockers.length === 0) break;
      next.y = Math.max(...blockers.map((other) => other.y + other.h));
    }

    placed[id] = next;
  }

  return placed;
};

const random = (seed: number) => {
  let value = seed;

  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;

    return value / 0x1_0000_0000;
  };
};

const fixture = (seed: number, count: number) => {
  const next = random(seed);
  const layouts: Record<string, DashboardLayout> = {};

  for (let index = 0; index < count; index++) {
    const w = 1 + Math.floor(next() * 6);
    const h = 1 + Math.floor(next() * 6);
    layouts[`widget-${index}`] = {
      x: Math.floor(next() * (13 - w)),
      y: Math.floor(next() * 40),
      w,
      h,
    };
  }

  return layouts;
};

describe("dashboard layout resolution", () => {
  it("preserves the original resolver for dense, overlapping layouts", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const input = fixture(seed, 30);
      const priorityId = seed % 3 === 0 ? "widget-7" : undefined;
      const order = orderDashboardLayout(input, priorityId);
      const override: DashboardLayout = { x: 2, y: 3, w: 5, h: 4 };

      expect(
        resolveDashboardLayout(
          input,
          order,
          priorityId ? { id: priorityId, layout: override } : undefined,
        ),
      ).toEqual(
        referenceResolve(priorityId ? { ...input, [priorityId]: override } : input, priorityId),
      );
    }
  });

  it("reuses a gesture's order and original positions for every pointer update", () => {
    const input = fixture(99, 12);
    const resolve = createDashboardLayoutResolver(input, "widget-0");

    for (const layout of [
      { x: 0, y: 0, w: 4, h: 3 },
      { x: 5, y: 2, w: 4, h: 3 },
      { x: 2, y: 8, w: 6, h: 4 },
    ]) {
      expect(resolve(layout)).toEqual(
        referenceResolve({ ...input, "widget-0": layout }, "widget-0"),
      );
    }
  });

  it("keeps a large stack bounded by grid cells rather than widget count", () => {
    const input = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`widget-${index}`, { x: 0, y: 0, w: 12, h: 1 }]),
    );
    const resolved = resolveDashboardLayout(input, orderDashboardLayout(input));

    expect(resolved["widget-99"]?.y).toBe(99);
    expect(Object.values(resolved).every((layout) => layout.y >= 0)).toBe(true);
  });

  it("does not mutate the input layouts", () => {
    const input = fixture(7, 8);
    const before = structuredClone(input);

    createDashboardLayoutResolver(input, "widget-2")({ x: 1, y: 1, w: 3, h: 2 });

    expect(input).toEqual(before);
  });
});
