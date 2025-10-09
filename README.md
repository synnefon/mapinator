# Mapinator  
**Live demo:** [https://synnefon.github.io/mapinator/](https://synnefon.github.io/mapinator/)

Mapinator is a lightweight, in-browser procedural terrain generator.

It leverages Delaunay triangulation, Voronoi cells, and Simplex noise to generate colorful biome maps, and lets you customize them with various dials.

Each map gets a “unique” name from Mapinator’s built-in word generator. Punch in a name you’ve seen before (or just make one up), and Mapinator will create that world for you.

---

## Run locally

```bash
npm install
npm run dev
```

Then open your browser at [http://localhost:5173](http://localhost:5173).

---

## Stack

- **TypeScript**  
- **Vite** (bundler + dev server)  
- **Delaunator** (mesh)  
- **Simplex-Noise** (elevation & moisture)  

---

## Resources

- [Azgaar's Fantasy Map Generator](https://github.com/Azgaar/Fantasy-Map-Generator?tab=readme-ov-file)
- Amit Patel's [Polygonal Map Generation for Games](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation/)

---


<img width="1673" height="887" alt="Screenshot 2025-10-09 at 1 28 18 AM" src="https://github.com/user-attachments/assets/d75a80bc-ad57-4063-a2bc-691ea944421f" />


