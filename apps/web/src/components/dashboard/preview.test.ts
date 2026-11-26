// @vitest-environment happy-dom
import { createComponent, flush } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "@solidjs/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DashboardWidget } from "@mattrax/enterprise-domain/client";
import { recorder } from "../../../../../packages/config/testing/recorder.ts";
import DashboardPreview from "./preview";

/** Inject the batch hook through the component's seam instead of its module. */
const useBatch = recorder<[options?: { readonly preview?: boolean }], undefined>(() => undefined);

const widget = (index: number): DashboardWidget => ({
  id: `widget-${index}`,
  type: "table",
  title: `Widget ${index}`,
  config: { dataset: "devices", limit: 200 },
  x: 0,
  y: 0,
  w: 12,
  h: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const cleanups: Array<() => void> = [];

const renderHtml = (view: () => JSX.Element) => {
  const container = document.createElement("div");

  document.body.append(container);
  cleanups.push(render(view, container));
  flush();

  return { html: container.innerHTML, text: container.textContent ?? "" };
};

beforeEach(() => useBatch.mockClear());

afterEach(() => {
  for (const dispose of cleanups.splice(0).reverse()) dispose();

  document.body.replaceChildren();
});

describe("DashboardPreview batch mode", () => {
  it("requests preview data for only the first three widgets", () => {
    const widgets = Array.from({ length: 4 }, (_, index) => widget(index));

    renderHtml(() =>
      createComponent(DashboardPreview, {
        widgets,
        widgetCount: widgets.length,
        useBatch,
      }),
    );

    expect(useBatch.calls).toEqual([[{ preview: true }], [{ preview: true }], [{ preview: true }]]);
  });

  it("preserves the empty-dashboard state without requesting widget data", () => {
    const { text } = renderHtml(() =>
      createComponent(DashboardPreview, {
        widgets: undefined,
        widgetCount: 0,
        useBatch,
      }),
    );

    expect(text).toContain("Empty dashboard");
    expect(useBatch.calls).toEqual([]);
  });
});
