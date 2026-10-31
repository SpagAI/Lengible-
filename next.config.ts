import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Read PDFs on the server (background processing) with the library as-is, not bundled.
  serverExternalPackages: ["pdfjs-dist"],
  // …and ship the PDF reader's worker file with the server code that reads PDFs.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // The service worker must never be cached, or updates won't reach installed apps.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
