import "server-only";

// Pulls the text out of files on the server, page by page (slides for PowerPoint, ~3,000-character pieces
// for Word), for background processing and for files read straight from Google Drive without keeping a copy.
// Same results as the browser reader in ./client.ts.

export type ServerPage = { page: number; text: string };

const clean = (s: string) =>
  s
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

// Each <a:p> paragraph is made of <a:t> text runs.
function slideText(xml: string) {
  return (xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) ?? [])
    .map((p) => (p.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) ?? []).map((t) => decode(t.replace(/^<a:t[^>]*>|<\/a:t>$/g, ""))).join(""))
    .filter(Boolean)
    .join("\n");
}

function paginate(text: string, size = 3000): ServerPage[] {
  const out: ServerPage[] = [];
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

export function officeKind(name: string, mime: string) {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pptx" || mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (ext === "docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  return null;
}

export async function extractOffice(buf: Buffer, kind: "pptx" | "docx"): Promise<{ pages: ServerPage[]; pageCount: number }> {
  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    const pages = paginate(value);
    return { pages, pageCount: pages.length };
  }
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const slideNo = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNo(a) - slideNo(b));
  const pages: ServerPage[] = [];
  for (const name of slides) {
    const n = slideNo(name);
    let text = slideText(await zip.file(name)!.async("string"));
    const notes = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    if (notes) {
      const noteText = slideText(await notes.async("string")).replace(/^\d+$/gm, "").trim();
      if (noteText) text += `\n\nNotes: ${noteText}`;
    }
    if (clean(text)) pages.push({ page: n, text: clean(text) });
  }
  return { pages, pageCount: slides.length };
}

// A page with less text than this is probably mostly a picture (read later by the AI).
const PICTURE_PAGE_CHARS = 40;

// Reads a PDF's pages from `from` on. With `until` (a time), stops there and says where to carry on (`next`),
// so a very long lecture can be read across several runs without starting again.
export async function extractPdf(buf: Buffer, opts: { from?: number; until?: number } = {}) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), verbosity: 0 });
  const doc = await task.promise;
  const pages: ServerPage[] = [];
  const pictureOnly: number[] = [];
  try {
    for (let i = opts.from ?? 1; i <= doc.numPages; i++) {
      if (opts.until && Date.now() > opts.until && pages.length + pictureOnly.length > 0) return { pages, pageCount: doc.numPages, pictureOnly, next: i };
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let text = "";
      for (const item of content.items) if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      const t = clean(text);
      if (t) pages.push({ page: i, text: t });
      if (t.length < PICTURE_PAGE_CHARS) pictureOnly.push(i);
      page.cleanup();
    }
    return { pages, pageCount: doc.numPages, pictureOnly, next: null as number | null };
  } finally {
    await task.destroy();
  }
}

// ——— Older and other formats ———

// Old Word (.doc, Word 97–2003).
async function extractDoc(buf: Buffer) {
  const WordExtractor = (await import("word-extractor")).default;
  const doc = await new WordExtractor().extract(buf);
  const text = [doc.getBody(), doc.getTextboxes?.({ includeHeadersAndFooters: false }) ?? "", doc.getFootnotes()].filter((t) => t?.trim()).join("\n\n");
  const pages = paginate(text.replace(/\r/g, "\n"));
  return { pages, pageCount: pages.length };
}

// Old PowerPoint (.ppt, PowerPoint 97–2003): the text records of each slide (titles, bullets, text boxes).
async function extractPpt(buf: Buffer) {
  const CFB = await import("cfb");
  const cf = CFB.read(buf, { type: "buffer" });
  const entry = CFB.find(cf, "PowerPoint Document");
  if (!entry?.content) throw new Error("This doesn't look like a PowerPoint file.");
  const data = Buffer.from(entry.content as Uint8Array);
  // Text listed per slide (SlideListWithText), and text inside each slide's drawing, as a fallback.
  const listed: string[][] = [];
  const drawn: string[][] = [];
  const walk = (start: number, end: number, ctx: { inList: boolean; inSlide: boolean; skip: boolean }) => {
    let o = start;
    while (o + 8 <= end) {
      const verInst = data.readUInt16LE(o);
      const type = data.readUInt16LE(o + 2);
      const len = data.readUInt32LE(o + 4);
      const body = o + 8;
      if (body + len > end || len > data.length) break;
      if ((verInst & 0x0f) === 0x0f) {
        // Containers: SlideListWithText 0x0FF0 (instance 0 = slides), Slide 0x03EE, Notes 0x03F0 and masters 0x03F8 skipped.
        const inst = verInst >> 4;
        if (type === 0x03ee) drawn.push([]);
        walk(body, body + len, {
          inList: ctx.inList || (type === 0x0ff0 && inst === 0),
          inSlide: ctx.inSlide || type === 0x03ee,
          skip: ctx.skip || type === 0x03f0 || type === 0x03f8 || (type === 0x0ff0 && inst !== 0),
        });
      } else if (!ctx.skip) {
        if (type === 0x03f3 && ctx.inList) listed.push([]);
        else if (type === 0x0fa0 || type === 0x0fa8) {
          const text = (type === 0x0fa0 ? data.toString("utf16le", body, body + len) : data.toString("latin1", body, body + len)).replace(/\r/g, "\n").replace(/\u000b/g, "\n");
          if (ctx.inList && listed.length) listed.at(-1)!.push(text);
          else if (ctx.inSlide && drawn.length) drawn.at(-1)!.push(text);
        }
      }
      o = body + len;
    }
  };
  walk(0, data.length, { inList: false, inSlide: false, skip: false });
  const slides = listed.some((t) => t.length) ? listed : drawn;
  const pages = slides.map((t, i) => ({ page: i + 1, text: clean(t.join("\n")) })).filter((p) => p.text);
  return { pages, pageCount: slides.length };
}

// Excel (.xlsx): each sheet's rows, one page per sheet (long sheets split).
async function extractXlsx(buf: Buffer) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const text: string[] = [];
  wb.eachSheet((sheet) => {
    const rows: string[] = [];
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => (v && typeof v === "object" ? ((v as { text?: string; result?: unknown }).text ?? String((v as { result?: unknown }).result ?? "")) : String(v ?? "")));
      if (cells.some((c) => c.trim())) rows.push(cells.join(" | "));
    });
    if (rows.length) text.push(`Sheet: ${sheet.name}\n${rows.join("\n")}`);
  });
  const pages = paginate(text.join("\n\n"));
  return { pages, pageCount: pages.length };
}

const xmlText = (xml: string) =>
  decode(
    xml
      .replace(/<text:line-break\/>/g, "\n")
      .replace(/<text:tab\/>/g, "\t")
      .replace(/<\/(text:p|text:h|table:table-row)>/g, "\n")
      .replace(/<\/table:table-cell>/g, " | ")
      .replace(/<[^>]+>/g, ""),
  );

// OpenDocument (.odt text, .odp slides, .ods sheets: LibreOffice / WPS / Google exports).
async function extractOdf(buf: Buffer, ext: string) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const xml = (await zip.file("content.xml")?.async("string")) ?? "";
  if (ext === "odp") {
    const slides = xml.match(/<draw:page[\s>][\s\S]*?<\/draw:page>/g) ?? [];
    const pages = slides.map((s, i) => ({ page: i + 1, text: clean(xmlText(s.replace(/<presentation:notes[\s\S]*?<\/presentation:notes>/g, ""))) })).filter((p) => p.text);
    return { pages, pageCount: slides.length };
  }
  const pages = paginate(xmlText(xml));
  return { pages, pageCount: pages.length };
}

// Web pages and e-book chapters: the readable text.
const htmlText = (html: string) =>
  decode(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " "),
  );

async function extractEpub(buf: Buffer) {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const chapters = Object.keys(zip.files)
    .filter((n) => /\.(x?html?)$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const text: string[] = [];
  for (const n of chapters) text.push(htmlText(await zip.file(n)!.async("string")));
  const pages = paginate(text.join("\n\n"));
  return { pages, pageCount: pages.length };
}

// Rich text (.rtf): drops the formatting codes and tables (fonts, colours, styles, pictures), keeps the words.
const RTF_SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "object", "fldinst", "filetbl", "revtbl", "pgdsctbl"]);
function rtfText(rtf: string) {
  let out = "";
  const stack: boolean[] = [];
  let skip = false;
  for (let i = 0; i < rtf.length; i++) {
    const c = rtf[i];
    if (c === "{") {
      stack.push(skip);
      // A group that starts with \* or a table/picture word is skipped whole.
      const head = rtf.slice(i + 1, i + 40).match(/^\\(\*|[a-z]+)/i);
      if (head && (head[1] === "*" || RTF_SKIP.has(head[1].toLowerCase()))) skip = true;
    } else if (c === "}") {
      skip = stack.pop() ?? false;
    } else if (c === "\\") {
      const m = rtf.slice(i + 1).match(/^([a-z]+)(-?\d+)? ?|^'([0-9a-f]{2})|^([\\{}])|^(\r?\n)/i);
      if (!m) continue;
      i += m[0].length;
      if (skip) continue;
      if (m[3]) out += String.fromCharCode(parseInt(m[3], 16));
      else if (m[4]) out += m[4];
      else if (m[5] || m[1] === "par" || m[1] === "line") out += "\n";
      else if (m[1] === "tab") out += "\t";
      else if (m[1] === "u" && m[2]) {
        const n = Number(m[2]);
        out += String.fromCharCode(n < 0 ? n + 65536 : n);
        // The fallback character after \uN is skipped.
        if (rtf[i + 1] === "?") i++;
      }
    } else if (!skip && c !== "\r" && c !== "\n") out += c;
  }
  return out;
}

export type ServerExtraction = { pages: ServerPage[]; pageCount: number; pictureOnly: number[]; kind: "pdf" | "pptx" | "docx" | "text" | "image" | "other" };

// File types Lengible can read (by extension).
export const READABLE_EXTENSIONS = ["pdf", "pptx", "ppt", "docx", "doc", "xlsx", "odt", "odp", "ods", "rtf", "epub", "html", "htm", "txt", "md", "csv", "tsv", "jpg", "jpeg", "png", "webp", "heic"];

// Any file Lengible reads: PDFs, PowerPoint and Word (new and old), Excel, OpenDocument, rich text, web pages,
// e-books, plain text, and pictures (which have no text: the AI reads them).
export async function extractAny(buf: Buffer, name: string, mime: string): Promise<ServerExtraction> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const done = (r: { pages: ServerPage[]; pageCount: number }, kind: ServerExtraction["kind"] = "text"): ServerExtraction => ({ ...r, pageCount: r.pageCount || r.pages.length, pictureOnly: [], kind });
  if (mime === "application/pdf" || ext === "pdf") return { ...(await extractPdf(buf)), kind: "pdf" };
  const office = officeKind(name, mime);
  if (office) return done(await extractOffice(buf, office), office);
  if (ext === "ppt" || mime === "application/vnd.ms-powerpoint") return done(await extractPpt(buf), "pptx");
  if (ext === "doc" || mime === "application/msword") return done(await extractDoc(buf), "docx");
  if (ext === "xlsx" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return done(await extractXlsx(buf));
  if (["odt", "odp", "ods"].includes(ext) || mime.startsWith("application/vnd.oasis.opendocument")) return done(await extractOdf(buf, ext || (mime.includes("presentation") ? "odp" : "odt")), ext === "odp" ? "pptx" : "text");
  if (ext === "epub" || mime === "application/epub+zip") return done(await extractEpub(buf));
  if (ext === "rtf" || mime === "application/rtf" || mime === "text/rtf") return done({ pages: paginate(rtfText(buf.toString("latin1"))), pageCount: 0 });
  if (ext === "html" || ext === "htm" || mime === "text/html") return done({ pages: paginate(htmlText(buf.toString("utf8"))), pageCount: 0 });
  if (mime.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "heic"].includes(ext)) return { pages: [], pageCount: 1, pictureOnly: [1], kind: "image" };
  if (mime.startsWith("text/") || ["txt", "md", "csv", "tsv"].includes(ext)) return done({ pages: paginate(buf.toString("utf8")), pageCount: 0 });
  return { pages: [], pageCount: 0, pictureOnly: [], kind: "other" };
}
