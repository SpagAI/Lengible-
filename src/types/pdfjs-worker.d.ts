// The PDF reader's worker module, loaded on the server so PDFs are read in the same process.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
