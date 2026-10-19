import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={56} height={56} className="mb-4 rounded-2xl" />
      <h1 className="text-2xl font-semibold tracking-tight">Lengible</h1>
      <p className="mb-6 text-sm text-muted">Sign in to sync your study across your phone, tablet and PC.</p>
      <LoginForm />
    </main>
  );
}
