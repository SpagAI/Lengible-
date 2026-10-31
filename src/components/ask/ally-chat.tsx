"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, MessageSquare, PanelLeft, Plus, Trash2, X } from "lucide-react";
import type { AskScope } from "@/lib/ask";
import { deleteAllyChat } from "@/app/(app)/ally/actions";
import { cx } from "@/components/ui";
import { BackButton } from "@/components/back-button";
import { AllyMark, Answer, EXAMPLES, useAllyChat, type Turn } from "./ask-panel";

export type ChatSummary = { id: string; title: string; updated_at: string };
type ScopeChoice = { label: string; scope: AskScope };

const sameScope = (a: AskScope, b: AskScope) => (a.courseId ?? null) === (b.courseId ?? null) && (a.folderId ?? null) === (b.folderId ?? null) && (a.fileId ?? null) === (b.fileId ?? null);

// Saved chats, newest first, grouped like "Today", "Yesterday", "Earlier".
function groupChats(chats: ChatSummary[]) {
  const day = (d: string) => new Date(d).toDateString();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const groups: { label: string; list: ChatSummary[] }[] = [
    { label: "Today", list: [] },
    { label: "Yesterday", list: [] },
    { label: "Earlier", list: [] },
  ];
  for (const c of chats) groups[day(c.updated_at) === today ? 0 : day(c.updated_at) === yesterday ? 1 : 2].list.push(c);
  return groups.filter((g) => g.list.length);
}

// The Ask Ally page: a chat like ChatGPT, Claude or Gemini, answering from your own slides.
export function AllyChat({
  scopes,
  chats,
  chat,
  historyMissing,
  initialText = "",
}: {
  scopes: ScopeChoice[];
  chats: ChatSummary[];
  chat?: { id: string; turns: Turn[]; scope: AskScope; scopeLabel: string } | null;
  historyMissing?: boolean;
  // Put in the message box (not sent), e.g. a past question from the question bank.
  initialText?: string;
}) {
  const router = useRouter();
  const [sidebar, setSidebar] = useState(false);
  // A saved chat keeps the scope it was asked in.
  const start = chat ? Math.max(0, scopes.findIndex((s) => sameScope(s.scope, chat.scope))) : 0;
  const [pick, setPick] = useState(start);
  const scope = chat?.scope ?? scopes[pick]?.scope ?? {};
  const scopeLabel = chat?.scopeLabel ?? scopes[pick]?.label ?? "All my materials";
  const { turns, send, busy, chatId, notSaved } = useAllyChat({ scope, scopeLabel, initial: chat ? { id: chat.id, turns: chat.turns } : undefined });
  const [text, setText] = useState(initialText);
  const input = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // Keep the newest message in view.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);
  // A new chat gets its own address (so going back returns to it) once it's saved.
  useEffect(() => {
    if (chatId && !chat) router.replace(`/ally?chat=${chatId}`, { scroll: false });
  }, [chatId, chat, router]);

  // Suggestions fill the box; nothing is sent until you press send.
  const fill = (q: string) => {
    setText(q);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(q.length, q.length);
    });
  };
  const submit = () => {
    if (!text.trim() || busy) return;
    const q = text;
    setText("");
    void send(q);
  };

  const history = (
    <nav className="flex h-full flex-col gap-2 p-3" aria-label="Your chats with Ally">
      <Link href="/ally" onClick={() => setSidebar(false)} className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-surface-2">
        <Plus size={16} /> New chat
      </Link>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {historyMissing ? (
          <p className="px-1 text-xs text-muted">Chat history needs one setup step: run supabase/migrations/0008_ally_and_history.sql in Supabase.</p>
        ) : chats.length === 0 ? (
          <p className="px-1 text-xs text-muted">Your chats with Ally are saved here.</p>
        ) : (
          groupChats(chats).map((g) => (
            <div key={g.label}>
              <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{g.label}</p>
              <ul className="space-y-0.5">
                {g.list.map((c) => (
                  <li key={c.id} className="group flex items-center">
                    <Link
                      href={`/ally?chat=${c.id}`}
                      onClick={() => setSidebar(false)}
                      className={cx("flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm", (chatId ?? chat?.id) === c.id ? "bg-brand-soft text-brand-strong" : "hover:bg-surface-2")}
                    >
                      <MessageSquare size={14} className="shrink-0 text-muted" />
                      <span className="truncate">{c.title}</span>
                    </Link>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm("Delete this chat?")) return;
                        await deleteAllyChat(c.id);
                        if ((chatId ?? chat?.id) === c.id) router.push("/ally");
                        else router.refresh();
                      }}
                      className="grid size-7 shrink-0 place-items-center rounded-lg text-muted opacity-60 hover:bg-surface-2 hover:text-danger group-hover:opacity-100"
                      aria-label={`Delete chat “${c.title}”`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </nav>
  );

  return (
    <div className="flex h-[calc(100dvh-56px-64px-env(safe-area-inset-bottom,0px))] overflow-hidden bg-bg md:h-[calc(100dvh-2rem)] md:rounded-2xl md:border md:border-border">
      {/* Saved chats: a column on wide screens, a drawer on phones. */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-surface md:block">{history}</aside>
      {sidebar && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-label="Your chats">
          <button type="button" className="absolute inset-0 bg-black/50" onClick={() => setSidebar(false)} aria-label="Close" />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-surface shadow-xl">
            <button type="button" onClick={() => setSidebar(false)} className="absolute top-3 right-3 grid size-8 place-items-center rounded-lg hover:bg-surface-2" aria-label="Close chats">
              <X size={16} />
            </button>
            <div className="h-full pt-10">{history}</div>
          </div>
        </div>
      )}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2">
          <BackButton />
          <button type="button" onClick={() => setSidebar(true)} className="grid size-9 place-items-center rounded-lg hover:bg-surface-2 md:hidden" aria-label="Your chats">
            <PanelLeft size={18} />
          </button>
          <AllyMark size={26} />
          <span className="font-semibold">Ally</span>
          <label className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted">
            <span className="hidden sm:inline">Searching</span>
            <select
              value={pick}
              disabled={turns.length > 0}
              onChange={(e) => setPick(Number(e.target.value))}
              className="min-h-8 max-w-[52vw] truncate rounded-full border border-border bg-surface px-3 text-xs text-text disabled:opacity-70"
              aria-label="Search in"
              title={turns.length ? "Start a new chat to search somewhere else" : undefined}
            >
              {chat && !scopes.some((s) => sameScope(s.scope, chat.scope)) && <option value={pick}>{chat.scopeLabel}</option>}
              {scopes.map((s, i) => (
                <option key={i} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {turns.length === 0 ? (
              <div className="flex flex-col items-center pt-[8vh] text-center">
                <AllyMark size={52} />
                <h1 className="mt-4 text-2xl font-semibold">Hi, I&apos;m Ally.</h1>
                <p className="mt-1 max-w-md text-sm text-muted">Ask me anything about your slides and notes. I answer from your own files and show you the exact slide.</p>
                <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
                  {EXAMPLES.map((e) => (
                    <button key={e} type="button" onClick={() => fill(e)} className="rounded-2xl border border-border bg-surface p-3 text-left text-sm hover:border-brand hover:bg-surface-2">
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {turns.map((t, i) => (
                  <div key={i} className="space-y-3">
                    <div className="flex justify-end">
                      <p className="max-w-[85%] rounded-3xl bg-surface-2 px-4 py-2.5 text-sm whitespace-pre-wrap">{t.q}</p>
                    </div>
                    <div className="flex items-start gap-3">
                      <AllyMark size={28} />
                      <div className="min-w-0 flex-1 pt-0.5">
                        {t.result ? (
                          <Answer turn={t} onPick={fill} />
                        ) : t.error ? (
                          <p className="text-sm text-danger">{t.error}</p>
                        ) : (
                          <p className="flex items-center gap-2 text-sm text-muted">
                            <Loader2 size={16} className="animate-spin" /> Searching your slides…
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={bottom} />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-bg px-3 pt-2 pb-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-3xl border border-border bg-surface p-2 shadow-sm focus-within:border-brand"
          >
            <textarea
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder={turns.length ? "Ask a follow-up…" : "Message Ally…"}
              className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none [field-sizing:content]"
              aria-label="Your question"
            />
            <button type="submit" disabled={busy || !text.trim()} aria-label="Send" className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-on-brand disabled:opacity-40">
              {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowUp size={18} />}
            </button>
          </form>
          <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted">
            Ally answers from your processed files and can make mistakes; check the sources.{notSaved ? " This chat isn't being saved (see the note in your chats)." : ""}
          </p>
        </div>
      </section>
    </div>
  );
}
