import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "./types";
import { supabaseEnv } from "./env";

type DB = ReturnType<typeof createServerClient<Database>>;
// The background worker runs without a browser (no sign-in cookies): it sets the client to use for that work.
const override = new AsyncLocalStorage<DB>();
export const withClient = <T>(client: DB, fn: () => Promise<T>) => override.run(client, fn);

export async function createClient() {
  const fixed = override.getStore();
  if (fixed) return fixed;
  const cookieStore = await cookies();
  const { url, key } = supabaseEnv();
  return createServerClient<Database>(
    url!,
    key!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy refreshes the session instead.
          }
        },
      },
    },
  );
}

// Returns the signed-in user, or sends them to the login page.
// Checked once per page load (the layout and the page share it), and checked on this server from the sign-in
// token's signature where possible, instead of asking Supabase's sign-in server over the internet every time.
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) redirect("/login");
  return { supabase, user: { id: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined } as SignedInUser };
});

export type SignedInUser = { id: string; email?: string };
