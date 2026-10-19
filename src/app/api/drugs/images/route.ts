import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findOfficialImages } from "@/lib/dailymed";

export const maxDuration = 60;

// Looks up official label images for a drug on NIH DailyMed.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ status: "error", message: "Please sign in again." }, { status: 401 });
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) return NextResponse.json({ status: "error", message: "No drug name." });
  const images = await findOfficialImages(name);
  if (images === null) return NextResponse.json({ status: "error", message: "Couldn't reach DailyMed right now. Try again later." });
  return NextResponse.json({ status: "ok", images });
}
