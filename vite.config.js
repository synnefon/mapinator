import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { applyPicks, applyValues } from "./tune-config.mjs";

const BASE = "/mapinator";

// Loopback-only guard: the tuning routes write to disk, so they must never be reachable from
// another machine (e.g. when the dev server is started with --host).
const isLoopback = (req) => {
  const a = req.socket?.remoteAddress ?? "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
};

// Strip the optional base prefix so "/tune" and "/mapinator/tune" both match.
const routeOf = (url) => {
  const p = (url ?? "").split("?")[0];
  return p.startsWith(BASE) ? p.slice(BASE.length) || "/" : p;
};

// Dev-only: serve the tuning wizard at /tune and accept dial writes at POST /tune/write.
// Both are localhost-only. Not present in production builds (apply: "serve").
const tuneWizard = () => ({
  name: "tune-wizard",
  apply: "serve",
  configureServer(server) {
    const settingsPath = resolve(server.config.root, "src/common/settings.ts");
    const htmlPath = resolve(server.config.root, "explorer.html");
    const sweepHtmlPath = resolve(server.config.root, "sweep.html");

    server.middlewares.use(async (req, res, next) => {
      const route = routeOf(req.url);
      // /sweep — dev-only Mountain × Mountain Range image grid. No disk writes, so no loopback guard.
      if (route === "/sweep") {
        const html = await server.transformIndexHtml(
          req.originalUrl ?? req.url,
          readFileSync(sweepHtmlPath, "utf8")
        );
        res.setHeader("Content-Type", "text/html");
        res.end(html);
        return;
      }
      if (route !== "/tune" && route !== "/tune/write" && route !== "/tune/save")
        return next();
      if (!isLoopback(req)) {
        res.statusCode = 403;
        res.end("tuning wizard is localhost-only");
        return;
      }

      if (route === "/tune") {
        const html = await server.transformIndexHtml(
          req.originalUrl ?? req.url,
          readFileSync(htmlPath, "utf8")
        );
        res.setHeader("Content-Type", "text/html");
        res.end(html);
        return;
      }

      // POST /tune/write — { picks: [{ path, value }, …] } → recenter each dial in settings.ts.
      // POST /tune/save  — { values: [{ path, value }, …] } → write each dial value verbatim
      //                    (the main app's "save current settings" button).
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        try {
          const parsed = JSON.parse(body || "{}");
          const results =
            route === "/tune/save"
              ? applyValues(settingsPath, parsed.values)
              : applyPicks(settingsPath, parsed.picks);
          res.end(JSON.stringify({ ok: true, results }));
        } catch (e) {
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
        }
      });
    });
  },
});

export default defineConfig({
  base: BASE,
  plugins: [tuneWizard()],
  // Generation, colour, and LOD logic are pure — unit-tested in a node env (no DOM/WebGL).
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
