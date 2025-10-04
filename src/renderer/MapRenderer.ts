import type { Map } from "../common/map";
import { Delaunay } from "d3-delaunay";

export class MapRenderer {
    public drawCellColors(canvas: HTMLCanvasElement, map: Map): void {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { gridsize, points, biomes } = map;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.scale(canvas.width / gridsize, canvas.height / gridsize);

        // Optional: paint a background so any remaining subpixel gaps aren't black
        // ctx.fillStyle = "#111";
        // ctx.fillRect(0, 0, gridsize, gridsize);

        // Build Voronoi clipped to the box
        const dela = Delaunay.from(points, p => p.x, p => p.y);
        const vor = dela.voronoi([0, 0, gridsize, gridsize]);

        for (let i = 0; i < points.length; i++) {
            const poly = vor.cellPolygon(i); // Array<[x,y]> (closed)
            if (!poly || poly.length < 3) continue;

            ctx.beginPath();
            ctx.moveTo(poly[0][0], poly[0][1]);
            for (let k = 1; k < poly.length; k++) ctx.lineTo(poly[k][0], poly[k][1]);
            ctx.closePath();

            // Fill
            const fill = biomes[i].color;
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
