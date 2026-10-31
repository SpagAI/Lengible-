"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/drugs";
import type { AllyChat } from "@/lib/supabase/types";

// Ally chats are saved after every answer, so you can go back to them later (needs migration 0008).
export async function saveAllyChat(chat: { id?: string | null; title: string; scope: AllyChat["scope"]; scope_label: string; messages: unknown[] }) {
  const { supabase } = await requireUser();
  const row = { title: chat.title.slice(0, 120) || "New chat", scope: chat.scope, scope_label: chat.scope_label, messages: chat.messages, updated_at: new Date().toISOString() };
  const { data, error } = chat.id
    ? await supabase.from("ally_chats").update(row).eq("id", chat.id).select("id").single()
    : await supabase.from("ally_chats").insert(row).select("id").single();
  if (error) return { error: isMissingTable(error) ? "missing" : error.message };
  revalidatePath("/ally");
  return { id: data.id as string };
}

export async function deleteAllyChat(id: string) {
  const { supabase } = await requireUser();
  await supabase.from("ally_chats").delete().eq("id", id);
  revalidatePath("/ally");
}
