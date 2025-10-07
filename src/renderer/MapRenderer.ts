import { Delaunay } from "d3-delaunay";
import type { MapGenSettings } from "../common/config";
import type { Map } from "../common/map";
import { BiomeEngine } from "./BimeColor";

export class MapRenderer {
    public drawCellColors(canvas: HTMLCanvasElement, map: Map, settings: MapGenSettings): void {
        const engine = new BiomeEngine(settings.rainfall, settings.seaLevel);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const { resolution, points } = map;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(canvas.width / resolution, canvas.height / resolution);

        // Build Voronoi clipped to the box
        const dela = Delaunay.from(points, p => p.x, p => p.y);
        const vor = dela.voronoi([0, 0, resolution, resolution]);

        for (let i = 0; i < points.length; i++) {
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
