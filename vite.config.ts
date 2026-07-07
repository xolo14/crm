import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // Keep the entire React runtime in one chunk (splitting react vs react-dom causes runtime crashes).
          if (/node_modules\/(react-dom|react-router|react|scheduler)\//.test(id)) {
            return "vendor-react";
          }
          if (id.includes("@tanstack/react-query")) return "vendor-query";
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("jspdf") || id.includes("html2canvas")) return "vendor-pdf";
        },
      },
    },
  },
}));
