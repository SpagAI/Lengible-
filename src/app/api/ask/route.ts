import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ask, type AskScope, type AskTurn } from "@/lib/ask";
import { AIError } from "@/lib/ai";

// Two AI calls plus searching thousands of pages.
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { question?: string; scope?: AskScope; history?: AskTurn[] };
  const question = String(body.question ?? "").trim().slice(0, 1000);
  if (!question) return NextResponse.json({ error: "Type a question first." }, { status: 400 });
  try {
    return NextResponse.json(await ask(supabase, question, body.scope ?? {}, (body.history ?? []).slice(-2)));
  } catch (e) {
    const message = e instanceof AIError ? e.message : "Something went wrong searching your files. Please try again.";
    if (!(e instanceof AIError)) console.error("ask failed", e);
    return NextResponse.json({ error: message }, { status: 200 });
  }
}
