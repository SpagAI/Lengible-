import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { markDriveItemDone } from "@/lib/drive-import";

// The browser finished reading a file brought in from Drive.
export async function POST(_req: Request, ctx: RouteContext<"/api/drive/items/[id]/done">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  if (!(await markDriveItemDone(supabase, id))) return NextResponse.json({ status: "error" }, { status: 404 });
  return NextResponse.json({ status: "ok" });
}
