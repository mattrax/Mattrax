import { geoCentroid, geoGraticule10, geoOrthographic, geoPath } from "d3-geo";
import type { Feature, Geometry } from "geojson";
import { Schema } from "effect";
import { Portal } from "@solidjs/web";
import { createMemo, createSignal, For, Show } from "solid-js";
import { LoadingState } from "~/components/ui";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { ChevronDown, Globe, Plus, RotateCcw, Search } from "~/components/ui/icons";

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

const decodeWorld = Schema.decodeUnknownSync(WorldSchema);

let cachedWorld: World | undefined;
let worldPromise: Promise<World> | undefined;

const fetchWorld = (): Promise<World> => {
  if (cachedWorld) return Promise.resolve(cachedWorld);
  worldPromise ??= fetch("/assets/world-countries.geojson")
    .then(async (response) => {
      if (!response.ok) throw new Error(`Map request failed (${response.status})`);

      return decodeWorld(await response.json());
    })
    .then((world) => {
      cachedWorld = world;

      return world;
    })
    .catch((error: unknown) => {
      worldPromise = undefined;
      throw error;
    });

  return worldPromise;
};

let regionNames: Intl.DisplayNames | undefined;

try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = undefined;
}

const regionName = (code: string): string => {
  const normalized = code.trim().toUpperCase();

  if (normalized.length !== 2) return normalized;

  try {
    return regionNames?.of(normalized) ?? normalized;
  } catch {
    return normalized;
  }
};

const flagOf = (code: string): string =>
  code
    .trim()
    .toUpperCase()
    .replaceAll(/[A-Z]/g, (character) => String.fromCodePoint(127397 + character.charCodeAt(0)));

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

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
export function RegionPicker(props: {
  value: string;
  disabled?: boolean;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [world, setWorld] = createSignal<World>();
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
  let globeSurface: HTMLDivElement | undefined;

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

  const zoomBy = (factor: number) => setZoom((current) => clamp(current * factor, 1, 3));

  const choose = (country: Country) => {
    setSelected(country.properties.iso.toUpperCase());
    setQuery("");
    setResultsOpen(false);
    focusCountry(country);
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
      setLambda(dragging.lambda - dx * 0.3);
      setPhi(clamp(dragging.phi + dy * 0.3, -80, 80));
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

  const apply = (code: string) => {
    props.onChange(code.toUpperCase());
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label={
          props.value
            ? `App Store region: ${regionName(props.value)} (${props.value.toUpperCase()})`
            : "App Store region: Use default (US)"
        }
        disabled={props.disabled}
        onClick={openPicker}
        class="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-card px-2.5 text-left text-[13px] text-foreground outline-none transition-[border-color,box-shadow] duration-[var(--duration-hover)] ease-swift hover:border-border-strong focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Show
          when={props.value}
          fallback={
            <>
              <Globe class="size-3.5 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate text-muted-foreground">Use default (US)</span>
            </>
          }
        >
          <span class="shrink-0 text-[15px] leading-none">{flagOf(props.value)}</span>
          <span class="min-w-0 flex-1 truncate">{regionName(props.value)}</span>
          <span class="shrink-0 font-mono text-[10.5px] text-muted-foreground">
            {props.value.toUpperCase()}
          </span>
        </Show>
        <ChevronDown class="ml-auto size-3.5 shrink-0 text-muted-foreground" />
      </button>

      <Portal>
        <Dialog open={open()} onOpenChange={setOpen}>
          <DialogContent class="w-[min(calc(100vw-2rem),50rem)] max-h-[min(90vh,46rem)]">
            <DialogHeader>
              <DialogTitle>Choose App Store region</DialogTitle>
              <DialogDescription>
                Drag the globe to rotate it, scroll to zoom, or search for a country. Clicking a
                country resolves its two-letter storefront code.
              </DialogDescription>
            </DialogHeader>

            <div class="relative z-20">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query()}
                onInput={(event) => {
                  setQuery(event.currentTarget.value);
                  setResultsOpen(true);
                }}
                onFocus={() => setResultsOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
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
                      <p class="px-2.5 py-2 text-[11.5px] text-muted-foreground">
                        No countries match.
                      </p>
                    }
                  >
                    <For each={matches()}>
                      {(country) => (
                        <button
                          type="button"
                          onClick={() => choose(country.country)}
                          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                        >
                          <span class="text-[14px] leading-none">{flagOf(country.code)}</span>
                          <span class="min-w-0 flex-1 truncate">{country.name}</span>
                          <span class="font-mono text-[10px] text-muted-foreground">
                            {country.code}
                          </span>
                        </button>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>

            <Show
              when={mapState() === "ready" && world()}
              fallback={
                <div class="flex h-[360px] flex-col items-center justify-center gap-2 text-[12px] text-muted-foreground">
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
                <div class="relative mx-auto mt-1 aspect-square w-full max-w-[480px]">
                  <div
                    ref={(element) => {
                      globeSurface = element;
                    }}
                    data-region-globe
                    class="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
                    onWheel={onWheel}
                    onPointerDown={(event) => {
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
                          <stop offset="100%" stop-color="var(--foreground)" stop-opacity="0.14" />
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
                                ? "var(--brand-solid)"
                                : hovered() === country.properties.iso
                                  ? "var(--brand-muted)"
                                  : "var(--card)"
                            }
                            stroke="var(--border)"
                            stroke-width="0.55"
                            vector-effect="non-scaling-stroke"
                            class="cursor-pointer transition-[fill] duration-[var(--duration-press)] ease-swift"
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
                  </div>

                  <div
                    class="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-border bg-card/95 shadow-card"
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      aria-label="Zoom in"
                      class="flex size-7 items-center justify-center text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                      onClick={() => zoomBy(1.25)}
                    >
                      <Plus class="size-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label="Zoom out"
                      class="flex size-7 items-center justify-center border-t border-border text-[15px] leading-none text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                      onClick={() => zoomBy(0.8)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label="Reset globe view"
                      class="flex size-7 items-center justify-center border-t border-border text-muted-foreground transition-colors hover:bg-hover hover:text-foreground"
                      onClick={resetView}
                    >
                      <RotateCcw class="size-3.5" />
                    </button>
                  </div>

                  <Show when={hovered()}>
                    {(code) => (
                      <div class="pointer-events-none absolute left-2 top-2 rounded-md bg-popover/95 px-2 py-1 text-[11px] font-medium text-foreground shadow-card ring-1 ring-border">
                        {regionName(code())}
                      </div>
                    )}
                  </Show>
                </div>
              )}
            </Show>

            <DialogFooter class="items-center justify-between gap-3 sm:justify-between">
              <div class="flex min-w-0 items-center gap-2">
                <span class="text-[17px] leading-none">{flagOf(selected())}</span>
                <div class="min-w-0">
                  <p class="truncate text-[12.5px] font-[550] text-foreground">
                    {regionName(selected())}
                  </p>
                  <p class="font-mono text-[10px] text-muted-foreground">{selected()}</p>
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

            <p class="text-[10px] leading-relaxed text-muted-foreground">
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
