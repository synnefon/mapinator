import { describe, expect, it } from "vitest";
import { Quat } from "../common/3DMath";
import { globeRadiusPx } from "./GlobeRenderer";
import { makeProjector } from "./projection";

// The projection used to be re-derived inside 7 overlays + 3 DOM classes, untestable without a live
// canvas. As a pure function of (width, height, orientation, zoom, offset) it tests directly.
const W = 800;
const H = 600;
const OFFSET = 0.125;

describe("makeProjector", () => {
  it("exposes radius/refRadius/zoom consistent with globeRadiusPx", () => {
    const p = makeProjector(W, H, Quat.identity, 0.3, OFFSET);
    expect(p.zoom).toBe(0.3);
    expect(p.radius).toBe(globeRadiusPx({ width: W, height: H }, 0.3));
    expect(p.refRadius).toBe(globeRadiusPx({ width: W, height: H }, 0)); // the zoom-0 reference
  });

  it("projects the camera-facing point to centre + horizontal offset, marked front", () => {
    const p = makeProjector(W, H, Quat.identity, 0, OFFSET);
    const r = p.project({ x: 0, y: 0, z: 1 }); // +z faces the camera under the identity view
    expect(r.x).toBeCloseTo(W / 2 + OFFSET * W, 9);
    expect(r.y).toBeCloseTo(H / 2, 9);
    expect(r.front).toBe(true);
  });

  it("scales by radius and flips screen y for an off-centre point", () => {
    const p = makeProjector(W, H, Quat.identity, 0, OFFSET);
    const r = p.project({ x: 0, y: 1, z: 0 }); // world north → straight up on screen, sitting on the limb
    expect(r.x).toBeCloseTo(W / 2 + OFFSET * W, 9);
    expect(r.y).toBeCloseTo(H / 2 - p.radius, 9); // +y world maps to a SMALLER screen y
  });

  it("marks the back hemisphere and the bare limb as not front", () => {
    const p = makeProjector(W, H, Quat.identity, 0, 0);
    expect(p.project({ x: 0, y: 0, z: 1 }).front).toBe(true); // facing the camera
    expect(p.project({ x: 1, y: 0, z: 0 }).front).toBe(false); // exactly on the limb (z = 0 < MIN_FRONT_Z)
    expect(p.project({ x: 0, y: 0, z: -1 }).front).toBe(false); // behind the globe
  });

  it("projectDir returns a screen-space direction with y flipped", () => {
    const p = makeProjector(W, H, Quat.identity, 0, 0);
    const d = p.projectDir({ x: 0, y: 1, z: 0 });
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(-1, 9); // world +y points up the screen (negative screen y)
  });
});
