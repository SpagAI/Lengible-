"use client";

// Pulls the text out of a file in the browser, page by page (or slide by slide), so large files
// never have to pass through the server. Scanned PDFs and photos have no text layer; those are
// read by the AI later, on request.

export type ExtractedPage = { page: number; text: string };
// pictureOnly: PDF pages with (almost) no text, e.g. a slide that is one diagram or micrograph, or a scan.
export type Extraction = { pages: ExtractedPage[]; pageCount: number; hasText: boolean; pictureOnly?: number[] };

const clean = (s: string) =>
  s
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Splits long text (Word files have no pages) into ~3,000-character pieces at paragraph breaks.
function paginate(text: string, size = 3000): ExtractedPage[] {
  const out: ExtractedPage[] = [];
  let buf = "";
  for (const para of text.split(/\n{2,}/)) {
    if (buf && buf.length + para.length > size) {
      out.push({ page: out.length + 1, text: clean(buf) });
      buf = "";
    }
    buf += (buf ? "\n\n" : "") + para;
  }
  if (clean(buf)) out.push({ page: out.length + 1, text: clean(buf) });
  return out;
}

async function extractPdf(data: ArrayBuffer): Promise<Extraction> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push({ page: i, text: clean(text) });
    page.cleanup();
  }
  await task.destroy();
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  // Fewer than ~40 characters a page means it's a scan.
  return {
    pages: pages.filter((p) => p.text),
    pageCount: pages.length,
    hasText: chars > 40 * pages.length * 0.5,
    pictureOnly: pages.filter((p) => p.text.length < PICTURE_PAGE_CHARS).map((p) => p.page),
  };
}

// A page with less text than this is probably mostly a picture.
export const PICTURE_PAGE_CHARS = 40;

// Draws chosen PDF pages as JPEG pictures (base64), one at a time, so the AI can read them.
export async function* renderPdfPages(data: ArrayBuffer, pageNumbers: number[], width = 1100) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const canvas = document.createElement("canvas");
  try {
    for (const n of pageNumbers) {
      if (n < 1 || n > doc.numPages) continue;
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, width / base.width) });
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      page.cleanup();
      yield { page: n, data: canvas.toDataURL("image/jpeg", 0.62).split(",")[1] };
    }
  } finally {
    await task.destroy();
  }
}

// The picture-only pages of a PDF, for files uploaded before these pages were read.
export async function findPicturePages(data: ArrayBuffer) {
  const r = await extractPdf(data);
  return { pictureOnly: r.pictureOnly ?? [], pageCount: r.pageCount };
}

async function extractDocx(data: ArrayBuffer): Promise<Extraction> {
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: data });
  const pages = paginate(value);
  return { pages, pageCount: pages.length, hasText: pages.length > 0 };
}

async function extractPptx(data: ArrayBuffer): Promise<Extraction> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(data);
  const slideNo = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));
  const textOf = (xml: string) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    // Each <a:p> is a paragraph made of <a:t> runs.
    return Array.from(doc.getElementsByTagName("a:p"))
      .map((p) => Array.from(p.getElementsByTagName("a:t")).map((t) => t.textContent ?? "").join(""))
      .filter(Boolean)
      .join("\n");
  };
  const pages: ExtractedPage[] = [];
  for (const name of slideFiles) {
    const n = slideNo(name);
    let text = textOf(await zip.file(name)!.async("string"));
    const notes = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    if (notes) {
      const noteText = textOf(await notes.async("string")).replace(/^\d+$/gm, "").trim();
      if (noteText) text += `\n\nNotes: ${noteText}`;
    }
    if (clean(text)) pages.push({ page: n, text: clean(text) });
  }
  return { pages, pageCount: slideFiles.length, hasText: pages.length > 0 };
}

export function fileKind(name: string, mime: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) return "image";
  if (mime.startsWith("text/") || ["txt", "md", "csv"].includes(ext)) return "text";
  return "other";
}

export async function extractText(file: Blob, name: string): Promise<Extraction> {
  const kind = fileKind(name, file.type);
  if (kind === "image" || kind === "other") return { pages: [], pageCount: 1, hasText: false };
  if (kind === "text") {
    const pages = paginate(await file.text());
    return { pages, pageCount: pages.length, hasText: pages.length > 0 };
  }
  const data = await file.arrayBuffer();
  if (kind === "pdf") return extractPdf(data);
  if (kind === "docx") return extractDocx(data);
  return extractPptx(data);
}
