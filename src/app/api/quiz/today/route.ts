import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AIError } from "@/lib/ai";
import { generateDailyQuiz, getTodayQuiz } from "@/lib/quiz";

export const maxDuration = 60;

// Makes today's quiz if it doesn't exist yet.
export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ status: "error", message: "Please sign in again." }, { status: 401 });
  if (await getTodayQuiz(supabase)) return NextResponse.json({ status: "ok" });
  try {
    await generateDailyQuiz(supabase);
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    if (e instanceof AIError) return NextResponse.json({ status: e.kind === "rate_limit" ? "rate_limited" : "error", message: e.message });
    return NextResponse.json({ status: "error", message: "Couldn't make today's quiz. Please try again." });
  }
}
