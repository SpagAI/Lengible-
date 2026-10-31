import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkDriveLinks } from "@/lib/drive-updates";
import { enqueue } from "@/lib/jobs";

// Google can be slow listing big folder trees.
export const maxDuration = 300;

// Checks your Drive links and puts what changed into the processing queue (worked on by the server).
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ items: [] });
  const r = await checkDriveLinks(supabase, req.nextUrl.searchParams.get("force") === "1");
  const queued = r.items.length ? await enqueue(supabase, r.items.map((i) => ({ driveItemId: i.id, name: i.changed ? `${i.name} (newer version)` : i.name, again: i.changed }))) : { added: 0 };
  return NextResponse.json({ ...r, queued: queued.added });
}
