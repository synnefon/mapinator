import Delaunator from "delaunator";
import type { MapGenSettings } from "../common/config";
import type { Point } from "../common/map";
import { makeRNG, type RNG } from "../common/random";

type PointGenReturn = {
    centers: Point[];
    delaunay: Delaunator<any>;
}

export class PointGenerator {
    private rng: RNG = () => 0; // set in genPoints
    private seed: string;

    constructor(seed: string) {
        this.seed = seed;
    }

    public reSeed(seed: string) {
        this.seed = seed;
    }

    public genPoints(settings: MapGenSettings): PointGenReturn {
        // makes it deterministic :)
        this.rng = makeRNG(`${this.seed}-${settings.resolution}`);

        const { resolution, jitter } = settings;

        const points = this.initPoints(resolution, jitter);
        const { centers, delaunay } = this.relaxPoints(points, 4);

        return { centers, delaunay };
    }

    // --- Halfedge helpers ---
    private nextHalfedge(e: number): number {
        return e % 3 === 2 ? e - 2 : e + 1;
    }
    private triOfEdge(e: number): number {
        return Math.floor(e / 3);
    }

    // Build an incident halfedge for each site i
    private buildInedges(d: Delaunator<any>, n: number): Int32Array {
        const inedge = new Int32Array(n).fill(-1);
        const { triangles } = d;
        for (let e = 0; e < triangles.length; e++) inedge[triangles[e]] = e;
        return inedge;
    }

    // Walk around a site i via halfedges; returns ring or null if cell is open (on hull)
    private halfedgesAroundSite(
        d: Delaunator<any>,
        inedge: Int32Array,
        i: number
    ): number[] | null {
        const { triangles, halfedges } = d;
        let e0 = inedge[i];
        if (e0 === -1) return null;

        const ring: number[] = [];
        let e = e0;
        do {
            ring.push(e);
            const eNext = this.nextHalfedge(e);
            const opp = halfedges[eNext];
            if (opp === -1) return null; // open cell
            e = opp;

            // rotate within this triangle until triangles[e] === i
            if (triangles[e] !== i) {
                e = this.nextHalfedge(e);
                if (triangles[e] !== i) e = this.nextHalfedge(e);
            }
        } while (e !== e0);

        return ring;
    }

    // Triangle circumcenter (Voronoi vertex); fallback to barycenter if degenerate
    private circumcenterOfTri(points: ReadonlyArray<Point>, triIdx: number, d: Delaunator<any>): Point {
        const { triangles } = d;
        const a = points[triangles[3 * triIdx + 0]];
        const b = points[triangles[3 * triIdx + 1]];
        const c = points[triangles[3 * triIdx + 2]];

        const dA = a.x * a.x + a.y * a.y;
        const dB = b.x * b.x + b.y * b.y;
        const dC = c.x * c.x + c.y * c.y;

        const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        if (Math.abs(D) < 1e-12) {
            return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
        }
        const ux = (dA * (b.y - c.y) + dB * (c.y - a.y) + dC * (a.y - b.y)) / D;
        const uy = (dA * (c.x - b.x) + dB * (a.x - c.x) + dC * (b.x - a.x)) / D;
        return { x: ux, y: uy };
    }

    // Area-weighted polygon centroid with fallback
    private polygonCentroid(verts: Point[], fallback: Point): Point {
        let A = 0, cx = 0, cy = 0;
        const n = verts.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = verts[i].x, yi = verts[i].y;
            const xj = verts[j].x, yj = verts[j].y;
            const cross = xj * yi - xi * yj;
            A += cross;
            cx += (xj + xi) * cross;
            cy += (yj + yi) * cross;
        }
        if (Math.abs(A) < 1e-12) return fallback;
        const area = A / 2;
        return { x: cx / (6 * area), y: cy / (6 * area) };
    }

    // One Lloyd step: move each site to the centroid of its Voronoi cell (closed cells only)
    private relaxOnce(points: Point[]): { centers: Point[]; delaunay: Delaunator<any> } {
        const d = Delaunator.from(points, p => p.x, p => p.y);
        const inedge = this.buildInedges(d, points.length);
        const centers = new Array<Point>(points.length);

        for (let i = 0; i < points.length; i++) {
            const ring = this.halfedgesAroundSite(d, inedge, i);
            if (!ring) {
                // hull: keep original (or nudge inward if desired)
                centers[i] = points[i];
                continue;
            }
            const verts = ring.map(e => this.circumcenterOfTri(points, this.triOfEdge(e), d));
            centers[i] = this.polygonCentroid(verts, points[i]);
        }
        return { centers, delaunay: d };
    }

    // N iterations of Lloyd relaxation; returns final centers and last Delaunay
    private relaxPoints(points: Point[], iterations: number) {
        let pts = points;
        let last: Delaunator<any> | undefined;

        for (let k = 0; k < iterations; k++) {
            const { centers, delaunay } = this.relaxOnce(pts);
            pts = centers;
            last = delaunay;
        }
        if (!last) throw new Error("iterations wrong");

        return { centers: pts, delaunay: last };
    }


    private initPoints(resolution: number, jitter: number): Point[] {
        const points = [];
        for (let x = 0; x < resolution; x++) {
            for (let y = 0; y < resolution; y++) {
                const jx = x + (jitter * (this.rng() - this.rng()));
                const jy = y + (jitter * (this.rng() - this.rng()));
                points.push({ x: jx, y: jy });
            }
        }
        return points;
    }
}