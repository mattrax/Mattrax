/**
 * Rotation maths for the region globe.
 *
 * Keeping this out of the component makes the direction easy to test: a drag
 * moves the surface under the pointer, so dragging right brings land from the
 * west into the centre (a larger `lambda`) and dragging down brings land from
 * the north into the centre (a smaller `phi`).
 */
export type GlobeView = {
  readonly lambda: number;
  readonly phi: number;
  readonly zoom: number;
};

export const GLOBE_LATITUDE_LIMIT = 80;
export const GLOBE_MIN_ZOOM = 1;
export const GLOBE_MAX_ZOOM = 3;
export const GLOBE_KEY_STEP_DEGREES = 15;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/** Wrap a longitude into [-180, 180) so repeated drags cannot drift. */
export const wrapLongitude = (value: number) => {
  const wrapped = ((((value + 180) % 360) + 360) % 360) - 180;

  return wrapped === -180 ? 180 : wrapped;
};

export const clampLatitude = (value: number) =>
  clamp(value, -GLOBE_LATITUDE_LIMIT, GLOBE_LATITUDE_LIMIT);

export const clampZoom = (value: number) => clamp(value, GLOBE_MIN_ZOOM, GLOBE_MAX_ZOOM);

/**
 * Rotate from a pointer delta, in pixels. The default sensitivity matches the
 * previous globe feel; only the direction changes.
 */
export const rotateByDrag = (
  view: GlobeView,
  dx: number,
  dy: number,
  sensitivity = 0.3,
): GlobeView => ({
  lambda: wrapLongitude(view.lambda + dx * sensitivity),
  phi: clampLatitude(view.phi - dy * sensitivity),
  zoom: view.zoom,
});

/**
 * Rotate with the keyboard. Arrow keys pan the view, so Right looks east and
 * Up looks north. Returns `undefined` for keys the globe does not handle.
 */
export const rotateByKey = (
  view: GlobeView,
  key: string,
  step = GLOBE_KEY_STEP_DEGREES,
): GlobeView | undefined => {
  switch (key) {
    case "ArrowLeft":
      return { ...view, lambda: wrapLongitude(view.lambda + step) };
    case "ArrowRight":
      return { ...view, lambda: wrapLongitude(view.lambda - step) };
    case "ArrowUp":
      return { ...view, phi: clampLatitude(view.phi - step) };
    case "ArrowDown":
      return { ...view, phi: clampLatitude(view.phi + step) };
    default:
      return undefined;
  }
};
