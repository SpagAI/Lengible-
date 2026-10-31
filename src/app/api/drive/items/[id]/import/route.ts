import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { importDriveItem } from "@/lib/drive-import";

// Downloading big files from Google can take a while.
export const maxDuration = 300;

// Brings one Drive file into your Library (see importDriveItem).
export async function POST(_req: Request, ctx: RouteContext<"/api/drive/items/[id]/import">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ status: "error", message: "Please sign in again." }, { status: 401 });
  const r = await importDriveItem(supabase, auth.user.id, id);
  if (r.status !== "ok" || r.linkOnly) return NextResponse.json(r);
  const { data: signed } = await supabase.storage.from("library").createSignedUrl(r.path, 3600);
  return NextResponse.json({ ...r, url: signed?.signedUrl });
}
