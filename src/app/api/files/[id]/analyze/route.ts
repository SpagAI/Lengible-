import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { analyzeStep } from "@/lib/analysis/run";

// AI calls can be slow on the free tier; Vercel's free plan allows up to 300 seconds.
export const maxDuration = 300;

// One step of the AI pass; the browser calls again while the answer is "more".
// "?full=1" scans big files too (normally skipped to save the free AI allowance).
export async function POST(req: NextRequest, ctx: RouteContext<"/api/files/[id]/analyze">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(await analyzeStep(loaded.supabase, loaded.file, req.nextUrl.searchParams.get("full") === "1"));
}
