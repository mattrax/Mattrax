import { geoCentroid, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import { Effect, Schema } from "effect";
import { CatalogueService, runCatalogue } from "~/lib/catalogue-service";
import { Portal } from "@solidjs/web";
import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { LoadingState } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mattrax/ui";
import { Input } from "@mattrax/ui";
import { ChevronDown, Globe, Plus, RotateCcw, Search } from "~/components/ui/icons";
import { flagOf, regionName } from "~/components/region-label";
import { clampZoom, rotateByDrag, rotateByKey } from "~/components/region-globe";
import { isSubmitEnter } from "~/lib/ime";

const GLOBE_SIZE = 480;
const GLOBE_CENTER = GLOBE_SIZE / 2;
const BASE_SCALE = 205;

const CountrySchema = Schema.Struct({
  type: Schema.Literal("Feature"),
  properties: Schema.Struct({
    name: Schema.String,
    iso: Schema.String,
  }),
  geometry: Schema.Unknown,
});

const WorldSchema = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(CountrySchema),
});

type Country = typeof CountrySchema.Type;
type World = typeof WorldSchema.Type;

const fetchWorld = (): Promise<World> =>
  runCatalogue(
    CatalogueService.pipe(
      Effect.flatMap((service) => service.get("/assets/world-countries.geojson", WorldSchema)),
    ),
  );

const asFeature = (country: Country): Feature<Geometry> => ({
  type: "Feature",
  properties: country.properties,
  // SAFETY: the public asset is generated from Natural Earth and its geometry is
  // passed straight to d3-geo; only the properties are schema-checked here.
  geometry: country.geometry as Geometry,
});

/** Mainland-shaped geometry, so a country with distant islands still centres on its home landmass. */
const mainGeometry = (country: Country): Geometry => {
  const geometry = asFeature(country).geometry;

  if (geometry.type === "MultiPolygon" && geometry.coordinates[0])
    return { type: "Polygon", coordinates: geometry.coordinates[0] };

  return geometry;
};

const centerOn = (country: Country, projectionFactor = 1.55) => {
  const [longitude, latitude] = geoCentroid({
    ...asFeature(country),
    geometry: mainGeometry(country),
  });

  return { longitude, latitude, projectionFactor };
};

/**
 * A rotating orthographic globe for picking a two-letter App Store storefront.
 *
 * The countries are a static Natural Earth asset, so the 175 country outlines
 * never enter the worker bundle; d3-geo projects them on demand. Drag rotates,
 * the wheel zooms, and a click resolves the country's ISO alpha-2 code, which is
 * exactly the value the tenant form saves.
 */
export default function RegionPicker(props: {
  value: string;
  disabled?: boolean;
  onChange: (code: string) => void;
  /** Open the globe on mount; used when a placeholder click wakes the picker. */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = createSignal(props.initialOpen ?? false);
  const [world, setWorld] = createSignal<World>();

  // A click on the preload placeholder mounts this component with the dialog
  // already open; run the normal open path so the map starts fetching.
  onSettled(() => {
    if (props.initialOpen) openPicker();
  });
  const [mapState, setMapState] = createSignal<"idle" | "loading" | "ready" | "error">("idle");
  const [selected, setSelected] = createSignal((props.value || "US").toUpperCase());
  const [query, setQuery] = createSignal("");
  const [resultsOpen, setResultsOpen] = createSignal(false);
  const [hovered, setHovered] = createSignal<string>();
  const [lambda, setLambda] = createSignal(-10);
  const [phi, setPhi] = createSignal(-16);
  const [zoom, setZoom] = createSignal(1.1);
  let moved = false;
  let dragging:
    | {
        readonly startX: number;
        readonly startY: number;
        readonly lambda: number;
        readonly phi: number;
      }
    | undefined;
  let globeSurface: HTMLButtonElement | undefined;
  let searchInput: HTMLInputElement | undefined;

  const countries = createMemo(() => {
    const entries = (world()?.features ?? []).map((country) => {
      const code = country.properties.iso.toUpperCase();
      const name = regionName(code);

      return {
        code,
        name: name === code ? country.properties.name : name,
        country,
      };
    });

    return entries.sort((a, b) => a.name.localeCompare(b.name));
  });

  const matches = createMemo(() => {
    const term = query().trim().toLowerCase();

    if (!term) return [];

    return countries()
      .filter(
        (country) =>
          country.name.toLowerCase().includes(term) || country.code.toLowerCase().includes(term),
      )
      .slice(0, 8);
  });

  const projection = createMemo(() =>
    geoOrthographic()
      .translate([GLOBE_CENTER, GLOBE_CENTER])
      .scale(BASE_SCALE * zoom())
      .rotate([lambda(), phi()]),
  );

  const path = createMemo(() => geoPath(projection()));

  const pathFor = (country: Country): string => path()(asFeature(country)) ?? "";

  const spherePath = () => path()({ type: "Sphere" }) ?? "";

  const graticulePath = () => path()(geoGraticule10()) ?? "";

  const selectedCountry = () =>
    world()?.features.find((country) => country.properties.iso.toUpperCase() === selected());

  const focusCountry = (country: Country, projectionFactor = 1.15) => {
    const point = centerOn(country, projectionFactor);
    setLambda(-point.longitude);
    setPhi(-point.latitude);
    setZoom(projectionFactor);
  };

  const centerSelected = (nextWorld: World, projectionFactor = 1.1) => {
    const country = nextWorld.features.find(
      (entry) => entry.properties.iso.toUpperCase() === selected(),
    );

    if (country) focusCountry(country, projectionFactor);
  };

  const loadMap = async () => {
    if (mapState() === "loading" || mapState() === "ready") return;
    setMapState("loading");

    try {
      const loaded = await fetchWorld();
      setWorld(loaded);
      setMapState("ready");
      centerSelected(loaded);
    } catch {
      setMapState("error");
    }
  };

  const openPicker = () => {
    setSelected((props.value || "US").toUpperCase());
    setQuery("");
    setResultsOpen(false);
    setHovered(undefined);
    setOpen(true);

    const loaded = world();

    if (loaded) centerSelected(loaded, 1.1);
    else {
      setZoom(1.1);
      setLambda(-10);
      setPhi(-16);
    }

    void loadMap();
  };

  const resetView = () => {
    const country = selectedCountry();

    if (country) {
      focusCountry(country, 1.1);
      return;
    }

    setZoom(1.1);
    setLambda(-10);
    setPhi(-16);
  };

  const zoomBy = (factor: number) => setZoom((current) => clampZoom(current * factor));

  const choose = (country: Country) => {
    setSelected(country.properties.iso.toUpperCase());
    setQuery("");
    setResultsOpen(false);
    focusCountry(country);

    // Selecting a result removes the focused button. Return focus to the
    // search field so keyboard users stay inside the dialog.
    requestAnimationFrame(() => searchInput?.focus({ preventScroll: true }));
  };

  const startRotate = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const surface = globeSurface;

    if (!surface) return;
    moved = false;
    dragging = {
      startX: event.clientX,
      startY: event.clientY,
      lambda: lambda(),
      phi: phi(),
    };

    const move = (moveEvent: PointerEvent) => {
      if (!dragging) return;
      const dx = moveEvent.clientX - dragging.startX;
      const dy = moveEvent.clientY - dragging.startY;

      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;

      const next = rotateByDrag(
        { lambda: dragging.lambda, phi: dragging.phi, zoom: zoom() },
        dx,
        dy,
      );

      setLambda(next.lambda);
      setPhi(next.phi);
    };

    const finish = () => {
      dragging = undefined;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    zoomBy(Math.exp(-event.deltaY * 0.0015));
  };

  /** Keep the globe usable without a pointer: arrows rotate, +/- zoom, 0 resets. */
  const onKeyDown = (event: KeyboardEvent) => {
    const next = rotateByKey({ lambda: lambda(), phi: phi(), zoom: zoom() }, event.key);

    if (next) {
      event.preventDefault();
      setLambda(next.lambda);
      setPhi(next.phi);

      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1.25);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(0.8);
    } else if (event.key === "0") {
      event.preventDefault();
      resetView();
    }
  };

  const apply = (code: string) => {
    props.onChange(code.toUpperCase());
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        aria-label={
          props.value
            ? `App Store region: ${regionName(props.value)} (${props.value.toUpperCase()})`
            : "App Store region: Use default (US)"
        }
        disabled={props.disabled}
        onClick={openPicker}
        class="flex h-9 w-full items-center text-left"
      >
        <Show
          when={props.value}
          fallback={
            <>
              <Globe class="size-3.5 shrink-0" />
              <span class="min-w-0 flex-1 truncate text-muted-foreground">Use default (US)</span>
            </>
          }
        >
          <span class="shrink-0 text-sm leading-none">{flagOf(props.value)}</span>
          <span class="min-w-0 flex-1 truncate">{regionName(props.value)}</span>
          <span class="shrink-0 font-mono text-xs text-muted-foreground">
            {props.value.toUpperCase()}
          </span>
        </Show>
        <ChevronDown class="ml-auto size-3.5 shrink-0" />
      </Button>

      <Portal>
        <Dialog open={open()} onOpenChange={setOpen}>
          <DialogContent class="w-full max-w-4xl max-h-full">
            <DialogHeader>
              <DialogTitle>Choose App Store region</DialogTitle>
              <DialogDescription>
                Drag the globe to rotate it, scroll or use plus and minus to zoom, or search for a
                country. With the globe focused, the arrow keys rotate it and 0 resets the view.
              </DialogDescription>
            </DialogHeader>

            <div class="relative z-20">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
              <Input
                ref={(element) => {
                  searchInput = element;
                }}
                value={query()}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setResultsOpen(true);
                }}
                onFocus={() => setResultsOpen(true)}
                onKeyDown={(event) => {
                  if (isSubmitEnter(event)) {
                    const first = matches()[0];

                    if (first) {
                      event.preventDefault();
                      choose(first.country);
                    }
                  }
                }}
                placeholder="Search countries or codes"
                aria-label="Search countries"
                class="pl-8"
                autocomplete="off"
              />
              <Show when={resultsOpen() && query().trim()}>
                <div class="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-popover">
                  <Show
                    when={matches().length > 0}
                    fallback={
                      <p class="px-2.5 py-2 text-xs text-muted-foreground">
                        No countries match.
                      </p>
                    }
                  >
                    <For each={matches()}>
                      {(country) => (
                        <Button
                          type="button"
                          onClick={() => choose(country.country)}
                          class="flex w-full items-center text-left"
                        >
                          <span class="text-sm leading-none">{flagOf(country.code)}</span>
                          <span class="min-w-0 flex-1 truncate">{country.name}</span>
                          <span class="font-mono text-xs text-muted-foreground">
                            {country.code}
                          </span>
                        </Button>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>

            <Show
              when={mapState() === "ready" && world()}
              fallback={
                <div class="flex h-90 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
                  <Show
                    when={mapState() === "error"}
                    fallback={<LoadingState label="Loading globe…" size={18} pattern="spiral" />}
                  >
                    <span>Couldn't load the globe.</span>
                    <Button size="xs" variant="outline" onClick={() => void loadMap()}>
                      Try again
                    </Button>
                  </Show>
                </div>
              }
            >
              {(loadedWorld) => (
                <div class="relative mx-auto mt-1 aspect-square w-full max-w-120">
                  <Button
                    type="button"
                    ref={(element: HTMLButtonElement | HTMLAnchorElement) => {
                      globeSurface = element as HTMLButtonElement;
                    }}
                    data-region-globe
                    aria-label="Region globe. Drag or use the arrow keys to rotate, plus and minus to zoom, and 0 to reset."
                    class="block h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
                    onWheel={onWheel}
                    onKeyDown={onKeyDown}
                    onPointerDown={(event: PointerEvent) => {
                      setResultsOpen(false);
                      startRotate(event);
                    }}
                    onPointerLeave={() => setHovered(undefined)}
                  >
                    <svg viewBox="0 0 480 480" class="h-full w-full">
                      <defs>
                        <radialGradient id="globe-shade" cx="34%" cy="28%" r="78%">
                          <stop offset="0%" stop-color="var(--card)" stop-opacity="0" />
                          <stop offset="72%" stop-color="var(--foreground)" stop-opacity="0.02" />
                          <stop offset="100%" stop-color="var(--foreground)" stop-opacity="0.08" />
                        </radialGradient>
                      </defs>
                      <path
                        d={spherePath()}
                        fill="var(--globe-ocean)"
                        stroke="var(--border-strong)"
                        stroke-width="0.8"
                        vector-effect="non-scaling-stroke"
                      />
                      <path
                        d={graticulePath()}
                        fill="none"
                        stroke="var(--border)"
                        stroke-width="0.4"
                        stroke-opacity="0.7"
                        vector-effect="non-scaling-stroke"
                      />
                      <For each={loadedWorld().features}>
                        {(country) => (
                          <path
                            d={pathFor(country)}
                            data-code={country.properties.iso.toLowerCase()}
                            fill={
                              selected() === country.properties.iso.toUpperCase()
                                ? "var(--globe-selected)"
                                : hovered() === country.properties.iso
                                  ? "var(--globe-hover)"
                                  : "var(--globe-land)"
                            }
                            stroke="var(--globe-land-stroke)"
                            stroke-width="0.55"
                            vector-effect="non-scaling-stroke"
                            class="cursor-pointer transition-colors duration-100 ease-swift"
                            onPointerEnter={() => setHovered(country.properties.iso)}
                            onClick={(event) => {
                              event.stopPropagation();

                              if (!moved) setSelected(country.properties.iso.toUpperCase());
                            }}
                          />
                        )}
                      </For>
                      <path d={spherePath()} fill="url(#globe-shade)" pointer-events="none" />
                    </svg>
                  </Button>

                  <div
                    class="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-border bg-card/95 shadow-card"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <Button
                      type="button"
                      aria-label="Zoom in"
                      class="flex size-7 items-center justify-center"
                      onClick={() => zoomBy(1.25)}
                    >
                      <Plus class="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      aria-label="Zoom out"
                      class="flex size-7 items-center justify-center"
                      onClick={() => zoomBy(0.8)}
                    >
                      −
                    </Button>
                    <Button
                      type="button"
                      aria-label="Reset globe view"
                      class="flex size-7 items-center justify-center"
                      onClick={resetView}
                    >
                      <RotateCcw class="size-3.5" />
                    </Button>
                  </div>

                  <Show when={hovered()}>
                    {(code) => (
                      <div class="pointer-events-none absolute left-2 top-2 rounded-md bg-popover/95 px-2 py-1 text-xs font-medium text-foreground shadow-card ring-1 ring-border">
                        {regionName(code())}
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>

            <DialogFooter class="items-center justify-between">
              <div class="flex min-w-0 items-center gap-2">
                <span class="text-base leading-none">{flagOf(selected())}</span>
                <div class="min-w-0">
                  <p class="truncate text-xs font-medium text-foreground">
                    {regionName(selected())}
                  </p>
                  <p class="font-mono text-xs text-muted-foreground">{selected()}</p>
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => apply("")}>
                  Use default
                </Button>
                <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" disabled={!selected()} onClick={() => apply(selected())}>
                  Use {selected()}
                </Button>
              </div>
            </DialogFooter>

            <p class="text-xs leading-relaxed text-muted-foreground">
              Map data:{" "}
              <a
                href="https://www.naturalearthdata.com/"
                target="_blank"
                rel="noreferrer"
                class="underline underline-offset-2 hover:text-foreground"
              >
                Natural Earth
              </a>{" "}
              (public domain).
            </p>
          </DialogContent>
        </Dialog>
      </Portal>
    </>
  );
}
