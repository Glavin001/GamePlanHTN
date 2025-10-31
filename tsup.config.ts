import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm", "iife"],
  dts: true,
  sourcemap: true,
  clean: true,
  globalName: "GamePlanHTN",
  outDir: "dist",
  outExtension({ format }) {
    if (format === "cjs") {
      return { js: ".cjs" };
    }

    if (format === "esm") {
      return { js: ".mjs" };
    }

    return { js: ".global.js" };
  },
});
