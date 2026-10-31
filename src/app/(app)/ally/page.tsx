import type { Metadata } from "next";
import { requireUser } from "@/lib/supabase/server";
import { courseTree, getCourses } from "@/lib/courses";
import { isMissingTable } from "@/lib/drugs";
import { AllyChat } from "@/components/ask/ally-chat";
import type { Turn } from "@/components/ask/ask-panel";
import type { AskScope } from "@/lib/ask";
import type { AllyChat as SavedChat } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Ask Ally" };
// Ally plans, searches and answers in one request.
export const maxDuration = 120;

export default async function AllyPage({ searchParams }: PageProps<"/ally">) {
  const sp = await searchParams;
  const { supabase } = await requireUser();
  const courses = await getCourses(supabase);
  // Where Ally can search: everything, a course, or a group like Pathology (all its courses). ?course= picks one first.
  const scopes: { label: string; scope: AskScope }[] = [{ label: "All my materials", scope: {} }];
  for (const c of courseTree(courses)) {
    scopes.push({ label: c.children.length ? `${c.name} (all)` : c.name, scope: { courseId: c.id } });
    for (const k of c.children) scopes.push({ label: `— ${k.name}`, scope: { courseId: k.id } });
  }
  const want = typeof sp.course === "string" ? sp.course : null;
  const at = want ? scopes.findIndex((s) => s.scope.courseId === want) : -1;
  if (at > 0) scopes.unshift(...scopes.splice(at, 1));

  // Your saved chats (newest first) and the one you opened.
  const { data: chats, error } = await supabase.from("ally_chats").select("id, title, updated_at").order("updated_at", { ascending: false }).limit(200);
  const chatId = typeof sp.chat === "string" ? sp.chat : null;
  const { data: open } = chatId && !error ? await supabase.from("ally_chats").select("*").eq("id", chatId).maybeSingle() : { data: null };
  const chat = open as SavedChat | null;

  return (
    <AllyChat
      key={chat?.id ?? `new-${want ?? ""}`}
      scopes={scopes}
      chats={chats ?? []}
      historyMissing={!!error && isMissingTable(error)}
      chat={chat ? { id: chat.id, turns: chat.messages as Turn[], scope: chat.scope as AskScope, scopeLabel: chat.scope_label ?? "All my materials" } : null}
    />
  );
}
