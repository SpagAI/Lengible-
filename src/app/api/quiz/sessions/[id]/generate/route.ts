import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStep } from "@/lib/quiz-engine";

// AI calls can be slow on the free tier; Vercel's free plan allows up to 300 seconds.
export const maxDuration = 300;

// Writes the next batch of a quiz's questions; the browser calls again while the answer is "more".
export async function POST(_req: Request, ctx: RouteContext<"/api/quiz/sessions/[id]/generate">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ status: "error", message: "Please sign in again." }, { status: 401 });
  try {
    return NextResponse.json(await generateStep(supabase, id));
  } catch (e) {
    return NextResponse.json({ status: "error", message: e instanceof Error ? e.message : "Something went wrong." });
  }
}
