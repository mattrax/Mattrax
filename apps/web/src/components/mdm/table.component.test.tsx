// @vitest-environment happy-dom

import { render } from "@solidjs/web";
import { createSignal, Errored, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MdmTable } from "./table";
import type { MdmColumn } from "./table";

vi.mock("~/lib/navigation", () => ({
  useNavigate: () => () => {},
}));

type Row = { id: string; name: string };

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  constructor(_callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
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

/** A MediaQueryList double whose listener bookkeeping the assertions can inspect. */
const createMediaQueryList = (query: string): MediaQueryList => {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const media = {
    media: query,
    matches: query.includes("min-width") || query.includes("prefers-reduced-motion"),
    onchange: null,
    addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "change") listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === "change") listeners.delete(listener);
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } satisfies MediaQueryList;

  return media;
};

/** Browser APIs the table touches, with animation frames disabled (no-animation path). */
const installTableGlobals = () => {
  const mediaQueries = new Map<string, MediaQueryList>();

  const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    let media = mediaQueries.get(query);

    if (!media) {
      media = createMediaQueryList(query);
      mediaQueries.set(query, media);
    }

    return media;
  });
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("requestAnimationFrame", undefined);
  vi.stubGlobal("cancelAnimationFrame", undefined);

  return { mediaQueries, matchMedia };
};

beforeEach(() => {
  ResizeObserverMock.instances = [];
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  ResizeObserverMock.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
          <MdmTable
            rows={rows()}
            columns={columns()}
            empty={<div>No rows</div>}
            isFetching={isFetching()}
            caption={caption()}
            rowHref={(row) => `/devices/${row.id}`}
          />
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
    const removedColumn = container.querySelector<HTMLTableCellElement>(
      'th[data-column-id="column-2"]',
    )!;
    const viewport = container.querySelector<HTMLDivElement>('div[role="region"][tabindex="0"]')!;
    const rowObserver = ResizeObserverMock.instances.find((observer) =>
      observer.observe.mock.calls.some(([element]) => element === firstRow),
    )!;
    const columnObserver = ResizeObserverMock.instances.find((observer) =>
      observer.observe.mock.calls.some(([element]) => element === removedColumn),
    )!;
    const viewportObserver = ResizeObserverMock.instances.find((observer) =>
      observer.observe.mock.calls.some(([element]) => element === viewport),
    )!;

    expect(rowObserver).toBeDefined();
    expect(columnObserver).toBeDefined();
    expect(viewportObserver).toBeDefined();

    const checkbox = firstRow.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.click();
    firstRow.focus();
    flush();

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

    expect(columnObserver.disconnect).toHaveBeenCalled();
    expect(columnObserver.unobserve).toHaveBeenCalledWith(removedColumn);
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
      observer.observe.mock.calls.some(([element]) => element === nextViewport),
    )!;
    expect(nextViewportObserver).toBeDefined();
    expect(nextViewportObserver).not.toBe(viewportObserver);
    expect(container.querySelector('[data-testid="table-error"]')).toBeNull();
    expect(errors).toEqual([]);

    const responsiveMedia = mediaQueries.get("(min-width: 640px)")!;
    const addedListener = vi.mocked(responsiveMedia.addEventListener).mock.calls[0]?.[1];
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
          <MdmTable rows={makeRows(80)} columns={makeColumns(13)} empty={<div>No rows</div>} />
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

    // The viewport, row and column observers are all live on this first render;
    // none has been disconnected by a rerender, so the counts below belong to
    // the dispose call alone.
    const observers = [...ResizeObserverMock.instances];
    expect(observers.length).toBeGreaterThanOrEqual(3);

    for (const observer of observers) expect(observer.disconnect).not.toHaveBeenCalled();

    dispose();
    dispose = undefined;

    for (const observer of observers) expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(errors).toEqual([]);
  });
});
