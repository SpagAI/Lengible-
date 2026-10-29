"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { signIn, type LoginState } from "./actions";
import { Button, Field, inputClass, cx } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <input name="email" type="email" autoComplete="email" required defaultValue={state.email} className={inputClass} />
      </Field>
      <Field label="Password">
        <span className="relative block">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            className={cx(inputClass, "pr-12")}
          />
          {/* Eye icon: shows or hides what you've typed */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            title={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-muted hover:text-text focus-visible:text-brand"
          >
            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
          </button>
        </span>
      </Field>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
