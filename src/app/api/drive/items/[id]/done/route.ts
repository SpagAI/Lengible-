import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// The browser finished reading a file brought in from Drive.
export async function POST(_req: Request, ctx: RouteContext<"/api/drive/items/[id]/done">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: item } = await supabase.from("drive_items").select("modified_time").eq("id", id).maybeSingle();
  if (!item) return NextResponse.json({ status: "error" }, { status: 404 });
  await supabase.from("drive_items").update({ status: "imported", imported_modified: item.modified_time, error: null, claimed_at: null }).eq("id", id);
  return NextResponse.json({ status: "ok" });
}
