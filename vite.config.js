import { defineConfig } from "vite";

export default defineConfig({
  publicDir: "public",
  assetsInclude: ["**/*.wgsl"],
  worker: {
    format: "es",
  },
});
