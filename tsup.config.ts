import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  dts: true,
  format: ["cjs", "esm", "iife"],
  globalName: "Firetell",
  outDir: "dist",
  sourcemap: true,
  clean: true
});
