import { NextResponse } from "next/server";
import { loadOwnFile } from "@/lib/api";
import { makeMaterialCards } from "@/lib/flashcards-material";

// AI calls can be slow on the free tier; Vercel's free plan allows up to 300 seconds.
export const maxDuration = 300;

// Makes the next batch of flashcards from a file; call again while the answer is "more".
export async function POST(_req: Request, ctx: RouteContext<"/api/files/[id]/flashcards">) {
  const { id } = await ctx.params;
  const loaded = await loadOwnFile(id);
  if ("error" in loaded) return loaded.error;
  return NextResponse.json(await makeMaterialCards(loaded.supabase, loaded.file));
}
