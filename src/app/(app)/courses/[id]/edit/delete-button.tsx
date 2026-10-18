"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";

export function DeleteCourseButton({ name }: { name: string }) {
  return (
    <Button
      type="submit"
      variant="danger"
      onClick={(e) => {
        if (!confirm(`Delete ${name}? This removes everything in it.`)) e.preventDefault();
      }}
    >
      <Trash2 size={16} /> Delete course
    </Button>
  );
}
