import type { Map } from "../common/map";
import type { MapGenSettings } from "../common/settings";
import { BiomeEngine } from "./BiomeColor";

export class MapRenderer {
  // recommend: call this whenever sites or bbox change
  private getVoronoi(map: Map) {
    const { resolution, delaunay } = map;
    const pad = resolution * 0.1;
    // cache on the map to avoid O(n) rebuilds on every pan/zoom
    if (!("voronoi" in map) || !map.voronoi) {
      (map as any).voronoi = delaunay.voronoi([
        -pad,
        -pad,
        resolution + pad,
        resolution + pad,
      ]);
    }
    return (map as any).voronoi;
  }

  public drawCellColors(
    canvas: HTMLCanvasElement,
    map: Map,
    settings: MapGenSettings,
    panX = 0,
    panY = 0,
    viewScale = 1.0
  ): void {
    const engine = new BiomeEngine(settings.rainfall, settings.seaLevel);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { resolution, points, elevations, moistures } = map;
    const vor = this.getVoronoi(map);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    // scale first (zoom), then translate (pan in pixels)
    const scale = (canvas.width / resolution) * viewScale;
    ctx.scale(scale, scale);
    ctx.translate(panX / scale, panY / scale);

    // compute view bounds in map coords (no funky divide-after-the-fact)
    const margin = resolution * 0.1; // keep your safety margin
    const minX = -panX / scale - margin;
    const maxX = (canvas.width - panX) / scale + margin;
    const minY = -panY / scale - margin;
    const maxY = (canvas.height - panY) / scale + margin;

    // pixel-based overdraw ~1 device px
    const pixelOverdraw = 0.75; // tweak 0.5–1.0 px
    const overdraw = 1 + pixelOverdraw / scale;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;

      ctx.fillStyle = engine.colorAt(
        settings.colorScheme,
        elevations[i],
        moistures[i]
      );

      // Cell-centered micro-scale to hide seams
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(overdraw, overdraw);
      ctx.translate(-p.x, -p.y);

      ctx.beginPath();
      vor.renderCell(i, ctx); // API: traces the clipped polygon for cell i
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  }
}
