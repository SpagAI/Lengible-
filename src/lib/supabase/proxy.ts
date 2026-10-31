import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv, isSupabaseConfigured } from "./env";

// The background worker signs its own requests (CRON_SECRET), so it skips the sign-in check.
const PUBLIC_PATHS = ["/login", "/offline", "/setup", "/api/worker/tick"];

// Refreshes the Supabase session cookie on every request and keeps signed-out visitors on the login page.
export async function updateSession(request: NextRequest) {
  const { url, key } = supabaseEnv();
  const isPublic = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!url || !key || !isSupabaseConfigured()) {
    return isPublic ? NextResponse.next() : NextResponse.redirect(new URL("/setup", request.url));
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user && !isPublic) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return response;
}
