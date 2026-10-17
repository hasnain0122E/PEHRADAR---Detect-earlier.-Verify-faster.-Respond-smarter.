// Copies MapLibre's web-worker files into public/ so the browser can load them at a fixed URL.
// MapLibre 6 resolves its worker relative to its own module at runtime, which a bundler cannot
// see; components/map/OpsMap.tsx points setWorkerUrl() at the copy. Runs before dev and build.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "maplibre-gl", "dist");
const target = join(root, "public", "vendor", "maplibre-gl");

mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(source, file), join(target, file));
}
console.log(`MapLibre worker copied to ${target}`);
