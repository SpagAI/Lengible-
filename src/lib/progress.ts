import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { todayISO } from "@/lib/dates";
import { bestStreak, currentStreak } from "@/lib/streak";

type DB = SupabaseClient<Database>;

export async function getStreak(supabase: DB) {
  const { data } = await supabase.from("daily_quizzes").select("quiz_date, score, completed_at, question_ids").order("quiz_date");
  const completed = (data ?? []).filter((q) => q.completed_at).map((q) => q.quiz_date);
  const today = todayISO();
  return {
    current: currentStreak(completed, today),
    best: bestStreak(completed),
    doneToday: completed.includes(today),
    history: data ?? [],
  };
}
