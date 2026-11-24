import { describe, expect, it } from "vitest";
import {
  clampLatitude,
  clampZoom,
  rotateByDrag,
  rotateByKey,
  wrapLongitude,
} from "./region-globe";

const view = { lambda: 0, phi: 0, zoom: 1.1 };

describe("region globe rotation", () => {
  it("follows the pointer: dragging right rotates the surface right", () => {
    expect(rotateByDrag(view, 10, 0, 0.3)).toEqual({
      lambda: wrapLongitude(3),
      phi: 0,
      zoom: 1.1,
    });
  });

  it("follows the pointer: dragging down brings northern land into view", () => {
    expect(rotateByDrag(view, 0, 10, 0.3)).toEqual({
      lambda: 0,
      phi: -3,
      zoom: 1.1,
    });
  });

  it("inverts both axes compared with the old drag", () => {
    const dragged = rotateByDrag({ lambda: 20, phi: 10, zoom: 1.1 }, 20, 20, 0.3);

    expect(dragged.lambda).toBeGreaterThan(20);
    expect(dragged.phi).toBeLessThan(10);
  });

  it("keeps latitude inside the visible hemisphere and wraps longitude", () => {
    expect(rotateByDrag(view, 0, 1_000).phi).toBe(-80);
    expect(rotateByDrag(view, 0, -1_000).phi).toBe(80);
    expect(rotateByDrag(view, 1_000, 0).lambda).toBe(wrapLongitude(300));
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
  });

  it("pans with the arrow keys so Right looks east and Up looks north", () => {
    expect(rotateByKey(view, "ArrowRight")?.lambda).toBe(-15);
    expect(rotateByKey(view, "ArrowLeft")?.lambda).toBe(15);
    expect(rotateByKey(view, "ArrowUp")?.phi).toBe(-15);
    expect(rotateByKey(view, "ArrowDown")?.phi).toBe(15);
    expect(rotateByKey(view, "Enter")).toBeUndefined();
  });

  it("clamps zoom to the range the projection uses", () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(4)).toBe(3);
    expect(clampZoom(1.7)).toBe(1.7);
    expect(clampLatitude(-200)).toBe(-80);
  });
});
