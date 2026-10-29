import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { AIError, generateJSON } from "@/lib/ai";

// AI calls can be slow on the free tier; Vercel's free plan allows up to 300 seconds.
export const maxDuration = 300;

// Pictures of a few pages (slides that are mostly a diagram, table, micrograph or scan), made in the
// browser. The AI writes down their text and describes what each picture shows, and that is saved
// as the page's text so search, topics, quizzes and flashcards can use it.
export async function POST(req: NextRequest, ctx: RouteContext<"/api/files/[id]/read-pages">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  const { supabase, file } = loaded;
  const body = (await req.json().catch(() => null)) as { pages?: { page: number; data: string }[] } | null;
  const pages = (body?.pages ?? []).filter((p) => Number.isInteger(p.page) && typeof p.data === "string" && p.data.length < 3_000_000).slice(0, 8);
  if (!pages.length) return NextResponse.json({ status: "error", message: "No pages sent." });

  try {
    const r = await generateJSON<{ pages: { page: number; text: string }[] }>(
      `These ${pages.length} images are pages ${pages.map((p) => p.page).join(", ")} (in that order) of "${file.name}", a medical student's ${file.doc_type.replace("_", " ")}.\n` +
        "For each page, write down all readable text (keep headings, lists and table rows). Then, for any picture, diagram, chart, " +
        "micrograph, specimen or film on it, add a line starting with 'Image:' describing what it shows in exam-useful terms " +
        "(what it is, the labelled or key features, and what it illustrates). Don't guess beyond what is visible.",
      {
        type: "object",
        properties: { pages: { type: "array", items: { type: "object", properties: { page: { type: "integer" }, text: { type: "string" } }, required: ["page", "text"] } } },
        required: ["pages"],
      },
      { files: pages.map((p) => ({ mimeType: "image/jpeg", data: p.data })), maxOutputTokens: 12_000, temperature: 0 },
    );
    const wanted = new Set(pages.map((p) => p.page));
    const rows = (r.pages ?? [])
      .filter((p) => wanted.has(p.page) && p.text?.trim())
      .map((p) => ({ file_id: id, course_id: file.course_id, page: p.page, content: p.text.trim().slice(0, 20000) }));
    // Replace whatever little text those pages had.
    await supabase.from("chunks").delete().eq("file_id", id).in("page", [...wanted]);
    if (rows.length) await supabase.from("chunks").insert(rows);
    return NextResponse.json({ status: "ok", saved: rows.length });
  } catch (e) {
    if (e instanceof AIError) return NextResponse.json({ status: e.kind === "rate_limit" || e.kind === "busy" ? "rate_limited" : "error", message: e.message });
    return NextResponse.json({ status: "error", message: "Couldn't read these pages with AI." });
  }
}
