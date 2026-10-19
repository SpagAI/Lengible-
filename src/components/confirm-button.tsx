"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui";

// A submit button that asks before going ahead.
export function ConfirmButton({ message, ...props }: ComponentProps<typeof Button> & { message: string }) {
  return (
    <Button
      type="submit"
      {...props}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    />
  );
}
