import type { MapGenSettings } from "../common/settings";
import type { Map } from "../common/map";
import { BiomeEngine } from "./BimeColor";
import { lerp } from "../common/util";

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

        // Use cached Delaunay to build Voronoi with extended bounds to prevent edge clipping
        const boundsPadding = resolution * 0.1;
        const vor = delaunay.voronoi([
            -boundsPadding,
            -boundsPadding,
            resolution + boundsPadding,
            resolution + boundsPadding
        ]);

        // Calculate viewport bounds in map coordinates for culling
        const margin = resolution * 0.1; // 10% margin
        const viewMinX = -panX / scale - margin;
        const viewMaxX = (canvas.width - panX) / scale + margin;
        const viewMinY = -panY / scale - margin;
        const viewMaxY = (canvas.height - panY) / scale + margin;

        for (let i = 0; i < points.length; i++) {
            // Skip points far outside viewport
            if (points[i].x < viewMinX || points[i].x > viewMaxX ||
                points[i].y < viewMinY || points[i].y > viewMaxY) {
                continue;
            }

            // --- Color ---
            const fill = engine.colorAt(settings.colorScheme, map.elevations[i], map.moistures[i]);
            ctx.fillStyle = fill;

            // Save context for per-cell transform
            ctx.save();

            // Translate to cell center, scale slightly larger, translate back
            // This creates a tiny overdraw to eliminate gaps.
            const px = points[i].x;
            const py = points[i].y;
            ctx.translate(px, py);
            // Adjust overdraw based on resolution. Higher resolution = more overdraw.
            const overdraw = lerp(1, 1.09, settings.resolution);
            ctx.scale(overdraw, overdraw);
            ctx.translate(-px, -py);

            // Render cell
            ctx.beginPath();
            vor.renderCell(i, ctx);
            ctx.fill();

            ctx.restore();
        }

        ctx.restore();
    }
}
