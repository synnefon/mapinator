import { Delaunay } from "d3-delaunay";
import type { MapGenSettings } from "../common/settings";
import type { Map } from "../common/map";
import { BiomeEngine } from "./BimeColor";

export class MapRenderer {
    public drawCellColors(
        canvas: HTMLCanvasElement,
        map: Map,
        settings: MapGenSettings,
        panX: number = 0,
        panY: number = 0,
        viewScale: number = 1.0
    ): void {
        const engine = new BiomeEngine(settings.rainfall, settings.seaLevel);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const { resolution, points, delaunay } = map;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();

        // Apply pan offset first (in canvas pixel coordinates)
        ctx.translate(panX, panY);

        // Then apply view scale (camera zoom) and map scale
        const scale = (canvas.width / resolution) * viewScale;
        ctx.scale(scale, scale);

        // Use cached Delaunay to build Voronoi (no rebuild!)
        const vor = delaunay.voronoi([0, 0, resolution, resolution]);

        // Calculate viewport bounds in map coordinates for culling
        const margin = resolution * 0.1; // 10% margin
        const viewMinX = -panX / scale - margin;
        const viewMaxX = (canvas.width - panX) / scale + margin;
        const viewMinY = -panY / scale - margin;
        const viewMaxY = (canvas.height - panY) / scale + margin;

        for (let i = 0; i < points.length; i++) {
            // Quick cull: skip points far outside viewport
            if (points[i].x < viewMinX || points[i].x > viewMaxX ||
                points[i].y < viewMinY || points[i].y > viewMaxY) {
                continue;
            }

            const poly = vor.cellPolygon(i); // Array<[x,y]> (closed)
            if (!poly || poly.length < 3) continue;

            ctx.beginPath();
            ctx.moveTo(poly[0][0], poly[0][1]);
            for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k][0], poly[k][1]);
            ctx.closePath();

            // --- Color ---
            const fill = engine.colorAt(settings.colorScheme, map.elevations[i], map.moistures[i]);
            ctx.fillStyle = fill;
            ctx.fillStyle = fill;
            ctx.fill();
            // Hairline same-color stroke to hide AA seams
            ctx.strokeStyle = fill;
            ctx.lineWidth = 0.05;
            ctx.lineJoin = "round";
            ctx.miterLimit = 2;
            ctx.stroke();
        }

        ctx.restore();
    }
}
