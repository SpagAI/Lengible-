// Reads the Supabase settings on the server at request time. The names are built
// dynamically so Next.js doesn't freeze them into the build: a value added in Vercel
// after a build still works. Values are trimmed because pasted keys often carry spaces.
const read = (name: string) => process.env[name]?.trim().replace(/^["']|["']$/g, "") || undefined;

export function supabaseEnv() {
  const url = read(["NEXT", "PUBLIC", "SUPABASE", "URL"].join("_"))?.replace(/\/+$/, "");
  const key = read(["NEXT", "PUBLIC", "SUPABASE", "ANON", "KEY"].join("_"));
  return { url, key };
}

export type EnvCheck = { name: string; status: "ok" | "missing" | "invalid"; hint?: string };

// Describes what's wrong with the settings without revealing their values.
export function checkSupabaseEnv(): EnvCheck[] {
  const { url, key } = supabaseEnv();
  const urlOk = !!url && /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url);
  const keyOk = !!key && (key.startsWith("eyJ") || key.startsWith("sb_publishable_"));
  return [
    {
      name: "NEXT_PUBLIC_SUPABASE_URL",
      status: !url ? "missing" : urlOk ? "ok" : "invalid",
      hint: url && !urlOk ? "Should look like https://abcdxyz.supabase.co (the Project URL, nothing after .co)." : undefined,
    },
    {
      name: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      status: !key ? "missing" : keyOk ? "ok" : "invalid",
      hint:
        key && !keyOk
          ? key.startsWith("sb_secret_")
            ? "This is the SECRET key. Use the anon / publishable key instead."
            : "Should start with eyJ… or sb_publishable_… (the anon / public key)."
          : undefined,
    },
  ];
}

export const isSupabaseConfigured = () => checkSupabaseEnv().every((c) => c.status === "ok");
