"use client";

import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// The server reads the Supabase URL and publishable key at runtime and hands them to the browser
// through this provider, so they don't need to be baked into the build.
const ConfigContext = createContext<{ url: string; key: string } | null>(null);

export function SupabaseProvider({ url, anonKey, children }: { url: string; anonKey: string; children: ReactNode }) {
  const value = useMemo(() => ({ url, key: anonKey }), [url, anonKey]);
  return createElement(ConfigContext.Provider, { value }, children);
}

let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function useSupabase() {
  const config = useContext(ConfigContext);
  if (!config) throw new Error("useSupabase must be used inside SupabaseProvider");
  client ??= createBrowserClient<Database>(config.url, config.key);
  return client;
}
