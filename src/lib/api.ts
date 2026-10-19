import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { LibraryFile } from "@/lib/supabase/types";

// Loads a file the signed-in user owns, or returns a JSON error response.
export async function loadOwnFile(id: string) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: NextResponse.json({ status: "error", message: "Please sign in again." }, { status: 401 }) };
  const { data } = await supabase.from("files").select("*").eq("id", id).maybeSingle();
  if (!data) return { error: NextResponse.json({ status: "error", message: "File not found." }, { status: 404 }) };
  return { supabase, file: data as LibraryFile };
}
