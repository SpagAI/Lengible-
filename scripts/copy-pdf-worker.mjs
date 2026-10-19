// Copies the PDF.js worker (compatibility build, which works on older phone browsers) into public/ so the browser can load it (run automatically on install and build).
import { copyFileSync } from "node:fs";
copyFileSync(new URL("../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), new URL("../public/pdf.worker.min.mjs", import.meta.url));
