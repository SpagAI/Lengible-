"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string; email?: string };

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const supabase = await createClient();
  let error;
  try {
    ({ error } = await supabase.auth.signInWithPassword({ email, password }));
  } catch (e) {
    error = { code: "fetch_failed", status: 0, message: e instanceof Error ? e.message : String(e) };
  }
  if (error) {
    if (error.code === "email_not_confirmed") return { error: "Confirm your email first — check your inbox.", email };
    if (error.code === "invalid_credentials") return { error: "Wrong email or password.", email };
    if (error.code === "over_request_rate_limit" || error.status === 429) return { error: "Too many sign-in attempts. Wait a few minutes and try again.", email };
    // No answer from Supabase at all: on the free plan this usually means the project was paused for inactivity.
    if (!error.status || error.status >= 500 || /fetch|network|ENOTFOUND|ECONNREFUSED/i.test(error.message)) {
      return {
        error:
          "Lengible can't reach your Supabase database. If your Supabase project was paused (free projects pause after about a week unused), open supabase.com/dashboard, restore the project, wait a minute and try again.",
        email,
      };
    }
    return { error: `Sign-in failed: ${error.message}`, email };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
