import { NextResponse, type NextRequest } from "next/server";
import { loadOwnFile } from "@/lib/api";

// Clears earlier AI results so the file is analysed again from the start.
export async function POST(_req: NextRequest, ctx: RouteContext<"/api/files/[id]/reset">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  await loaded.supabase.from("files").update({ analysis: null }).eq("id", id);
  return NextResponse.json({ status: "ok" });
}
