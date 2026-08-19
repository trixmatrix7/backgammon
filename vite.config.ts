/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Standalone single-app layout (the Chain Ludo monorepo splits the engine into packages/*; a
// standalone game keeps the engine in src/engine and aliases it the same way, so import sites read
// identically to the monorepo).
export default defineConfig({
  plugins: [react()],
  server: { port: 5188, strictPort: true },
  preview: { port: 5188, strictPort: true },
  resolve: {
    alias: {
      "@engine": fileURLToPath(new URL("./src/engine/index.ts", import.meta.url)),
      "@pvp-sdk/guest": fileURLToPath(new URL("./lib/pvp-sdk/guest.ts", import.meta.url)),
      "@pvp-sdk": fileURLToPath(new URL("./lib/pvp-sdk/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
