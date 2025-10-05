import { Delaunay } from "d3-delaunay";
import type { Map } from "../common/map";

type Coord = {x: number, y: number};

export class MapRenderer {
    public clearCells(canvas: HTMLCanvasElement): void {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    public drawCellColors(canvas: HTMLCanvasElement, map: Map): void {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { resolution, elevations, points, biomes } = map;

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

	    // Uncomment for a heightmap fill!
	    // const fill = "#000000" + (255 - Math.round(elevations[i] * 255)).toString(16);

            // Fill
            const fill = biomes[i].color;
            ctx.fillStyle = fill;
            ctx.fill();

            // Hairline same-color stroke to hide AA seams
            ctx.strokeStyle = fill;
            ctx.lineWidth = resolution / 1000;
            ctx.lineJoin = "bevel";
            ctx.stroke();
        }

        ctx.restore();
    }

    public drawPixelShadows(canvas: HTMLCanvasElement, map: Map): void {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { resolution, elevations, biomes } = map;

	ctx.save();
        ctx.scale(canvas.width / resolution, canvas.height / resolution);

	const shadowScale = 1;
	const shadowCurve = 1.25;
	const shadowIntensity = 2;
	const shadowOffset = {x: 0.5 * shadowScale, y: 0.5 * shadowScale};

	const elevationCurve = 0.45;
	const elevationIntensity = 0.6;

	const sunSize = 500 / resolution;

	const coverEdges = true;

	const coordsToIndex = (coords: Coord): number => {
            return (coords.y * resolution) + coords.x;
	};

	const indexToCoords = (i: number, resolution: number): Coord => {
	    const x = Math.floor(i / resolution);
	    const y = i % resolution;
	    return {x: x, y: y};
	}
	
	// Calculate the average of elements in a window within a 1d array.
	// const windowAvg = (elements: number[], centerIndex: number, windowSideLength: number): number => {
	//     const windowRadius = (windowSideLength - 1) / 2;
	//     const topLeftIndex = centerIndex - windowRadius - (windowRadius * resolution);
	//     const totalIndexCount = Math.pow(windowSideLength, 2);

	//     let sum = 0;
	//     let totalSummed = 0;
	//     for (let y = 0; y < windowSideLength; y++) {
    	//         for (let x = 0; x < windowSideLength; x++) {
        //             const index = topLeftIndex + (y * resolution) + x; 
	// 	    if (index < 0 || index >= elements.length) continue;

	// 	    sum += elements[index];
	// 	    totalSummed += 1;
    	//         }
	//     }

	//     const avg = sum / totalSummed;
	//     return avg;
	// };

	// Get the number of intersections between a point and the edge of its array (the sun).
	const countIntersections = (elements: number[], coords: Coord): number => {
	    const startElevation = elevations[coordsToIndex(coords)];
	    // TODO: We see a strange dark square in the top left corner when these values are close to 0.  Investigate!
            const end = {x: resolution / 2, y: resolution / 2};
	    const points = bresenhamLine({x: coords.x, y: coords.y}, {x: end.x, y: end.y});

	    let intersections = 0;
	    for (let i = 0; i < points.length; i++) {
		const index = coordsToIndex(points[i]);
	        const elevation = elevations[index];
		if (elevation >= startElevation) {
                    intersections++;
		}
	    }

	    return intersections;
	};

	// Calculate a circular windowed average around an index in a 1d array.
	const windowAvg = (elements: number[], index: number, radius: number): number => {
	    // Given a point's index, calculate its distance to the center index.
	    const centerCoords = indexToCoords(index, resolution);
	    const distanceFromCenter = (index: number): number => {
	    	const coords = indexToCoords(index, resolution);
		const dx = Math.pow(centerCoords.x - coords.x, 2);
		const dy = Math.pow(centerCoords.y - coords.y, 2);
		const d = Math.sqrt(dx + dy);
		return d;
	    };

	    const xOffset = (steps) => { return steps * resolution; };
	    const yOffset = (steps) => { return steps; };
	    const topLeftIndex = Math.round(index - xOffset(radius) - yOffset(radius));

	    const windowSideLength = ((2 * radius) + 1);
	    const totalCellCount = Math.pow(windowSideLength, 2);

	    let sum = 0;
	    let totalSummed = 0;
	    for (let i = 0; i < totalCellCount; i++) {
		const coords = indexToCoords(i, windowSideLength);
		const elementIndex = topLeftIndex + coords.x + coords.y;

		const distance = distanceFromCenter(elementIndex) / resolution;
		if (distance > radius) {
                    continue;
		}

		if (elementIndex >= elements.length || elementIndex < 0) {
                    continue;
		}

	        sum += elements[elementIndex];
	        totalSummed++;
	    }

	    const avg = sum / totalSummed;
	    return avg;
	};

	// Calculate a shadow intensity for each elevation we store.
        for (let i = 0; i < elevations.length; i++) {
	    let shadowHex = "#001122";
	    if (biomes[i].name == "ocean") {
                shadowHex = "#000044";
	    }

	    const coords = indexToCoords(i, resolution);
	    const intersections = countIntersections(elevations, coords);
	    const spotBrightness = Math.abs(intersections - sunSize);
	    const shadowDarkness = Math.pow(spotBrightness, shadowCurve) * shadowIntensity;

	    // Calculate a darkness value based on this cell and surrounding ones.
	    const smoothElevation = elevations[i];// windowAvg(elevations, i, 3);
	    const expElevation = Math.pow(smoothElevation, elevationCurve) / elevationIntensity;
	    const correctedElevation = Math.min(Math.max(expElevation, 0), 1);
	    const elevationDarkness = 255 - (correctedElevation * 255);
	    let shade = shadowDarkness + elevationDarkness;
	    
	    // Convert the final shade into a hex string and set the fill style.
            const shadowOpacity = Math.round(Math.min(shade, 255));
	    const shadowAlpha = shadowOpacity.toString(16).padStart(2, "0");
	    const shadowColor = shadowHex + shadowAlpha;
	    ctx.fillStyle = shadowColor;
	    
	    // If we are on the edge of the canvas (and the option is enabled), cover up those edges!
	    let finalShadowScale = shadowScale;
	    const edgeCoord = resolution - 1;
	    if (coverEdges && (coords.x == edgeCoord || coords.y == edgeCoord || coords.x == 0 || coords.y == 0)) {
		finalShadowScale *= 2;
	    }
	    
	    // Finally xD
	    ctx.fillRect(coords.x - shadowOffset.x, coords.y - shadowOffset.y, finalShadowScale, finalShadowScale);
        }

	ctx.restore();
    }
}

// Finds and returns the list of coordinates on a line between two points.
function bresenhamLine(src: Coord, dst: Coord): Coord[] {
    const points = [];

    // Calculate differences and determine step directions.
    const dx = Math.abs(dst.x - src.x);
    const dy = Math.abs(dst.y - src.y);
    const sx = Math.sign(dst.x - src.x);
    const sy = Math.sign(dst.y - src.y);

    let err = dx - dy;

    while (true) {
      points.push({ x: src.x, y: src.y });
      // If we've reached the end point, break.
      if (src.x === dst.x && src.y === dst.y) {
	  break;
      }

      // Decide whether to step in x, y, or both.
      const e2 = 2 * err;
      if (e2 > -dy) {
	  err -= dy;
	  src.x += sx;
      }
      if (e2 < dx) {
	  err += dx;
	  src.y += sy;
      }
    }

    return points;
}
