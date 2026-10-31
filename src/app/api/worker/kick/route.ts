import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { backfill, workQueue } from "@/lib/jobs";

// Per warm server: the catch-up scan (files part-processed earlier) runs at most every 10 minutes.
const lastScan = new Map<string, number>();

// An open Lengible tab nudges the queue now (no need to wait for the next minute). Works for ~50 seconds
// on your own files, then returns; the tab calls again while work is waiting.
export const maxDuration = 120;

export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  let queued = 0;
  if (Date.now() - (lastScan.get(auth.user.id) ?? 0) > 10 * 60_000) {
    lastScan.set(auth.user.id, Date.now());
    queued = (await backfill(supabase).catch(() => ({ added: 0 }))).added;
  }
  const r = await workQueue(supabase, auth.user.id, Date.now() + 105_000, 3);
  return NextResponse.json({ ...r, queued });
}
