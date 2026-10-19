import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { analyzeStep } from "@/lib/analysis/run";

export const maxDuration = 60;

// One step of the AI pass; the browser calls again while the answer is "more".
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/files/[id]/analyze">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(await analyzeStep(loaded.supabase, loaded.file));
}
