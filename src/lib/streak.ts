import { addDays } from "@/lib/dates";

// Current streak: consecutive days with a finished daily quiz, ending today
// (or yesterday, so the streak isn't lost before you've had a chance to play today).
export function currentStreak(completedDates: string[], today: string) {
  const done = new Set(completedDates);
  let day = done.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (done.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function bestStreak(completedDates: string[]) {
  const sorted = [...new Set(completedDates)].sort();
  let best = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && addDays(sorted[i - 1], 1) === sorted[i] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}
