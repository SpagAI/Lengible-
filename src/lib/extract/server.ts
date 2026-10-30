import "server-only";

// Pulls the text out of PowerPoint and Word files on the server, slide by slide (Word: ~3,000-character
// pieces), for files read straight from Google Drive without keeping a copy. Same results as the
// browser reader in ./client.ts.

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
