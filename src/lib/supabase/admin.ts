import "server-only";
import { createClient as createSupabase, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { supabaseEnv } from "./env";

// For the background worker only (never sent to the browser). Needs SUPABASE_SERVICE_ROLE_KEY:
// Supabase → Project Settings → API keys → secret key (sb_secret_…) or the legacy service_role key.
export const serviceKey = () => (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();

export function adminClient() {
  const { url } = supabaseEnv();
  const key = serviceKey();
  if (!url || !key) return null;
  return createSupabase<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// A client that acts as one user, with their usual permissions (row-level security stays on), so the worker
// can only ever see and change that user's own rows. Made with a one-time sign-in link that is never emailed;
// kept for 50 minutes on a warm server.
const cache = new Map<string, { client: SupabaseClient<Database>; until: number }>();

export async function clientForUser(userId: string): Promise<SupabaseClient<Database>> {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.client;
  const admin = adminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY isn't set, so the background worker can't run.");
  const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId);
  if (uErr || !u.user?.email) throw new Error(`Couldn't find the account (${uErr?.message ?? "no email"}).`);
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  if (linkErr || !link.properties?.hashed_token) throw new Error(`Couldn't start a worker session (${linkErr?.message ?? "no token"}).`);
  const { url, key } = supabaseEnv();
  const anon = createSupabase<Database>(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: session, error: vErr } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (vErr || !session.session) throw new Error(`Couldn't start a worker session (${vErr?.message ?? "no session"}).`);
  const client = createSupabase<Database>(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  cache.set(userId, { client, until: Date.now() + 50 * 60_000 });
  return client;
}
