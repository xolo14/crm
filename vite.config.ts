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
          // Vite's dynamic-import preload helper is needed by the entry chunk.
          // Without an explicit assignment Rollup colocates it inside vendor-pdf,
          // which forces the entry to statically import ~590 kB of PDF code on
          // first paint. Pin it (and other tiny shared utils like clsx, which
          // otherwise lands in vendor-charts) into the always-loaded React chunk.
          if (id.includes("vite/preload-helper")) return "vendor-react";
          if (!id.includes("node_modules")) return;
          if (/node_modules\/(clsx|tslib)\//.test(id)) return "vendor-react";

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
