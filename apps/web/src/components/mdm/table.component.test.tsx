// @vitest-environment happy-dom

import { render } from "@solidjs/web";
import { createSignal, Errored, flush } from "solid-js";
import type { Navigator } from "@solidjs/router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installGlobals } from "../../../../../packages/config/testing/globals.ts";
import { asFake, recorder } from "../../../../../packages/config/testing/recorder.ts";
import { NavigateContext } from "~/lib/navigation";
import { MdmTable } from "./table";
import type { MdmColumn } from "./table";

type Row = { id: string; name: string };

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  constructor(_callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe = recorder<[Element], void>();
  unobserve = recorder<[Element], void>();
  disconnect = recorder<[], void>();
}

const makeRows = (count: number): Row[] =>
  Array.from({ length: count }, (_, index) => ({ id: `row-${index}`, name: `Row ${index}` }));

const makeColumns = (count: number): MdmColumn<Row>[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `column-${index}`,
    header: `Column ${index}`,
    cell: (row: Row) => <span>{index === 0 ? row.name : `Value ${index}`}</span>,
  }));

let dispose: (() => void) | undefined;
let restoreGlobals: (() => void) | undefined;

/** A MediaQueryList double whose listener bookkeeping the assertions can inspect. */
const createMediaQueryList = (query: string) => {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const media = {
    media: query,
    matches: query.includes("min-width") || query.includes("prefers-reduced-motion"),
    onchange: null,
    addEventListener: recorder(
      (type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (type === "change" && listener) listeners.add(listener);
      },
    ),
    removeEventListener: recorder(
      (type: string, listener: EventListenerOrEventListenerObject | null) => {
        if (type === "change" && listener) listeners.delete(listener);
      },
    ),
    addListener: recorder<[EventListenerOrEventListenerObject | null], void>(),
    removeListener: recorder<[EventListenerOrEventListenerObject | null], void>(),
    dispatchEvent: recorder(() => true),
  };

  return media;
};

type MediaQueryListFake = ReturnType<typeof createMediaQueryList>;

/** Browser APIs the table touches. Frame callbacks never run, so no animation starts. */
const installTableGlobals = () => {
  const mediaQueries = new Map<string, MediaQueryListFake>();
  const matchMedia = recorder((query: string): MediaQueryList => {
    let media = mediaQueries.get(query);

    if (!media) {
      media = createMediaQueryList(query);
      mediaQueries.set(query, media);
    }

    return media as MediaQueryList;
  });

  // The Checkbox indicator schedules its check animation through these APIs.
  // No-op fakes keep it from starting while leaving the APIs callable.
  restoreGlobals = installGlobals({
    matchMedia,
    ResizeObserver: ResizeObserverMock,
    requestAnimationFrame: recorder(() => 1),
    cancelAnimationFrame: recorder(),
  });

  return { mediaQueries, matchMedia };
};

/** Navigation is injected; the table no longer needs a Router root in tests. */
const navigate = asFake<Navigator>(recorder((_to: string | number) => {}));

beforeEach(() => {
  ResizeObserverMock.instances = [];
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  restoreGlobals?.();
  restoreGlobals = undefined;
  ResizeObserverMock.instances = [];
  document.body.replaceChildren();
});

describe("MdmTable cleanup ownership", () => {
  it("mounts and updates without an error boundary and cleans up on rerender and unmount", () => {
    const errors: unknown[] = [];
    const { mediaQueries, matchMedia } = installTableGlobals();

    const [rows, setRows] = createSignal(makeRows(80));
    const [columns, setColumns] = createSignal(makeColumns(13));
    const [isFetching, setIsFetching] = createSignal(false);
    const [caption, setCaption] = createSignal("Devices");
    const container = document.createElement("div");
    document.body.append(container);

    dispose = render(
      () => (
        <Errored
          fallback={(error) => {
            errors.push(error());
            return <div data-testid="table-error">{String(error())}</div>;
          }}
        >
          <NavigateContext value={navigate}>
            <MdmTable
              rows={rows()}
              columns={columns()}
              empty={<div>No rows</div>}
              isFetching={isFetching()}
              caption={caption()}
              rowHref={(row) => `/devices/${row.id}`}
            />
          </NavigateContext>
        </Errored>
      ),
      container,
      undefined,
      { onError: (error) => errors.push(error) },
    );
    flush();

    expect(container.querySelector('[data-testid="table-error"]')).toBeNull();
    expect(errors).toEqual([]);
    expect(container.querySelector("table")?.getAttribute("aria-rowcount")).toBe("81");
    expect(container.querySelector('[data-virtualized="true"]')).not.toBeNull();
    expect(container.querySelector('[data-columns-virtualized="true"]')).not.toBeNull();

    const renderedRows = container.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-id]");
    expect(renderedRows.length).toBeGreaterThan(0);
    expect(renderedRows.length).toBeLessThan(80);
    const renderedColumns = container.querySelectorAll("th[data-column-id]");
    expect(renderedColumns.length).toBeGreaterThan(0);
    expect(renderedColumns.length).toBeLessThan(13);
    expect(container.querySelector('th[data-column-spacer="right"]')).not.toBeNull();
    const firstRow = renderedRows[0]!;
    const removedRow = container.querySelector<HTMLTableRowElement>(
      'tbody tr[data-row-id="row-6"]',
    )!;
    const viewport = container.querySelector<HTMLDivElement>('div[role="region"][tabindex="0"]')!;
    const rowObserver = ResizeObserverMock.instances.find((observer) =>
      observer.observe.calls.some(([element]) => element === firstRow),
    )!;
    const viewportObserver = ResizeObserverMock.instances.find((observer) =>
      observer.observe.calls.some(([element]) => element === viewport),
    )!;

    expect(rowObserver).toBeDefined();
    expect(viewportObserver).toBeDefined();

    // The primitive wires the change handler to the button; the native input is
    // only a hidden form proxy, so clicking it never toggles selection.
    const checkbox = firstRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const checkboxButton = firstRow.querySelector<HTMLButtonElement>('button[role="checkbox"]')!;
    checkboxButton.click();
    firstRow.focus();
    flush();

    expect(checkboxButton.getAttribute("aria-checked")).toBe("true");
    expect(checkbox.checked).toBe(true);
    expect(container.textContent).toContain("1 selected");
    expect(document.activeElement).toBe(firstRow);

    setIsFetching(true);
    setCaption("Updated devices");
    flush();

    expect(container.querySelector("caption")?.textContent).toBe("Updated devices");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(firstRow);
    expect(container.querySelector('[data-testid="table-error"]')).toBeNull();
    expect(errors).toEqual([]);

    setColumns(makeColumns(1));
    flush();

    // Virtualised columns use a fixed width, so there is no column observer;
    // the table leaves column virtualisation entirely for a narrow set.
    expect(container.querySelector('[data-columns-virtualized="true"]')).toBeNull();
    expect(checkbox.checked).toBe(true);
    expect(document.activeElement).toBe(firstRow);

    setRows(rows().slice(0, 2));
    flush();

    expect(container.querySelector('[data-virtualized="true"]')).toBeNull();
    expect(rowObserver.disconnect).toHaveBeenCalled();
    expect(rowObserver.unobserve).toHaveBeenCalledWith(removedRow);
    expect(document.activeElement).toBe(firstRow);
    expect(container.querySelector('[data-testid="table-error"]')).toBeNull();
    expect(errors).toEqual([]);

    setRows([]);
    flush();

    expect(container.querySelector("table")).toBeNull();
    expect(viewportObserver.disconnect).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="table-error"]')).toBeNull();
    expect(errors).toEqual([]);

    setRows(makeRows(2));
    flush();

    const nextViewport = container.querySelector<HTMLDivElement>(
      'div[role="region"][tabindex="0"]',
    )!;
    const nextViewportObserver = ResizeObserverMock.instances.find((observer) =>
      observer.observe.calls.some(([element]) => element === nextViewport),
    )!;
    expect(nextViewportObserver).toBeDefined();
    expect(nextViewportObserver).not.toBe(viewportObserver);
    expect(container.querySelector('[data-testid="table-error"]')).toBeNull();
    expect(errors).toEqual([]);

    const responsiveMedia = mediaQueries.get("(min-width: 640px)")!;
    const addedListener = responsiveMedia.addEventListener.calls[0]?.[1];
    expect(addedListener).toBeDefined();
    expect(responsiveMedia.addEventListener).toHaveBeenCalledTimes(1);
    expect(responsiveMedia.removeEventListener).not.toHaveBeenCalled();
    expect(matchMedia).toHaveBeenCalled();

    dispose();
    dispose = undefined;

    expect(responsiveMedia.removeEventListener).toHaveBeenCalledWith("change", addedListener);
    expect(errors).toEqual([]);
  });

  it("disconnects every live observer on a fresh virtualized-table unmount", () => {
    const errors: unknown[] = [];
    installTableGlobals();
    const container = document.createElement("div");
    document.body.append(container);

    dispose = render(
      () => (
        <Errored
          fallback={(error) => {
            errors.push(error());
            return <div data-testid="table-error">{String(error())}</div>;
          }}
        >
          <NavigateContext value={navigate}>
            <MdmTable rows={makeRows(80)} columns={makeColumns(13)} empty={<div>No rows</div>} />
          </NavigateContext>
        </Errored>
      ),
      container,
      undefined,
      { onError: (error) => errors.push(error) },
    );
    flush();

    expect(container.querySelector('[data-testid="table-error"]')).toBeNull();
    expect(errors).toEqual([]);
    expect(container.querySelector('[data-virtualized="true"]')).not.toBeNull();
    expect(container.querySelector('[data-columns-virtualized="true"]')).not.toBeNull();

    // The viewport and row observers are live on this first render; none has
    // been disconnected by a rerender, so the counts below belong to the
    // dispose call alone. (Columns use a fixed width, so no column observer.)
    const observers = [...ResizeObserverMock.instances];
    expect(observers.length).toBeGreaterThanOrEqual(2);

    for (const observer of observers) expect(observer.disconnect).not.toHaveBeenCalled();

    dispose();
    dispose = undefined;

    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });
});
