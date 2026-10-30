import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Layers, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/supabase/server";
import { getCourses } from "@/lib/courses";
import { courseParam, docTypeLabel, docTypes, formatBytes, importableTypes } from "@/lib/library";
import { updateFile, deleteFile } from "@/app/(app)/library/actions";
import { PageHeader, Card, Button, Field, inputClass, cx } from "@/components/ui";
import { PdfViewer } from "@/components/library/pdf-viewer";
import { FileActions } from "@/components/library/file-actions";
import { LinkedText } from "@/components/library/linked-text";
import { ConfirmButton } from "@/components/confirm-button";
import { MaterialCardsButton } from "@/components/flashcards/deck-buttons";
import { ProcessDetails } from "@/components/process-details";
import { ProcessFileButton } from "@/components/library/process-bar";
import type { Concept, LibraryFile } from "@/lib/supabase/types";

export async function generateMetadata({ params }: PageProps<"/library/file/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data } = await supabase.from("files").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "File" };
}

const kindLabel: Record<string, string> = { drug: "Drugs", disease: "Diseases", organism: "Organisms", investigation: "Investigations", other: "Other" };

export default async function FilePage({ params, searchParams }: PageProps<"/library/file/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "text" ? "text" : sp.tab === "details" ? "details" : "view";
  const startPage = Number(sp.page) || 1;
  const { supabase } = await requireUser();

  const { data } = await supabase.from("files").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const file = data as LibraryFile;
  const ext = file.storage_path.match(/\.[a-z0-9]+$/i)?.[0] ?? "";

  const [courses, { data: folders }, { data: topics }, { data: links }, { data: chunks }, view, download, { data: deck }, { data: outline }] = await Promise.all([
    getCourses(supabase),
    supabase.from("folders").select("id, name, course_id").order("name"),
    supabase.from("topics").select("id, name, course_id").neq("session_type", "section").order("name"),
    supabase.from("file_concepts").select("pages, concepts(*)").eq("file_id", id),
    tab === "text" ? supabase.from("chunks").select("page, content").eq("file_id", id).order("page") : Promise.resolve({ data: null }),
    supabase.storage.from("library").createSignedUrl(file.storage_path, 60 * 60),
    supabase.storage.from("library").createSignedUrl(file.storage_path, 60 * 60, { download: `${file.name}${ext}` }),
    supabase.from("decks").select("id").eq("file_id", id).maybeSingle(),
    supabase.from("topic_files").select("topic_id, start_page, end_page, subtopics, key_points").eq("file_id", id).order("start_page"),
  ]);
  const topicName = new Map((topics ?? []).map((t) => [t.id, t.name]));
  const reading = file.analysis as { kind?: string; cursor?: number; totalPages?: number; finished?: boolean; skipped?: boolean; v?: number } | null;
  const inProgress = reading?.kind === "concepts" && !reading.finished && !reading.skipped && (reading.cursor ?? 0) > 0;

  const course = courses.find((c) => c.id === file.course_id);
  const concepts = ((links ?? []) as unknown as { pages: number[]; concepts: Concept }[]).filter((l) => l.concepts);
  const byKind = new Map<string, typeof concepts>();
  for (const l of concepts) byKind.set(l.concepts.kind, [...(byKind.get(l.concepts.kind) ?? []), l]);
  const viewUrl = view.data?.signedUrl ?? "";
  const isPdf = ext.toLowerCase() === ".pdf";
  const isImage = file.mime_type?.startsWith("image/");
  const needsReview = !!(file.analysis as { pendingReview?: boolean } | null)?.pendingReview;
  const tabHref = (t: string) => `/library/file/${id}${t === "view" ? "" : `?tab=${t}`}`;

  return (
    <>
      <nav className="mb-1 flex flex-wrap items-center gap-1 text-sm text-brand">
        <Link href="/library">Library</Link>
        <ChevronRight size={14} className="text-muted" />
        <Link href={`/library/course/${courseParam(file.course_id)}${file.folder_id ? `?folder=${file.folder_id}` : ""}`}>
          {course?.name ?? "General"}
          {file.folder_id ? ` / ${folders?.find((f) => f.id === file.folder_id)?.name ?? ""}` : ""}
        </Link>
      </nav>
      <PageHeader
        title={file.name}
        subtitle={[docTypeLabel[file.doc_type], file.page_count ? `${file.page_count} ${file.page_count === 1 ? "page" : "pages"}` : null, formatBytes(file.size_bytes), file.version > 1 ? `version ${file.version}` : null]
          .filter(Boolean)
          .join(" · ")}
      />

      <FileActions
        file={{
          id: file.id,
          name: file.name,
          mime: file.mime_type,
          courseId: file.course_id,
          status: file.status,
          ext,
          scanSkipped: !!(file.analysis as { skipped?: boolean } | null)?.skipped,
          // A scan that stopped part-way (AI limit or busy) can carry on from where it got to.
          scanPausedAt:
            file.status !== "analysed" && !(file.analysis as { pendingReview?: boolean } | null)?.pendingReview
              ? ((file.analysis as { cursor?: number } | null)?.cursor ?? 0)
              : 0,
          pages: file.page_count ?? 0,
        }}
        viewUrl={viewUrl}
        downloadUrl={download.data?.signedUrl ?? viewUrl}
      />

      {/* Stored (e.g. from Drive) but not read yet: process it when you need it. */}
      {file.status === "uploaded" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft p-3 text-sm">
          <span className="text-brand-strong">Stored in your Library, not processed yet.</span>
          <ProcessFileButton file={{ id: file.id, name: file.name }} />
        </div>
      )}

      {/* Flashcards from this file (needs its text, so not for timetables or files still being read) */}
      {(file.status === "extracted" || file.status === "analysed") && !importableTypes.includes(file.doc_type) && (
        <div className="mt-3 flex flex-wrap items-start gap-3">
          {deck && (
            <Link href={`/flashcards/deck/${deck.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-soft px-4 text-sm font-medium text-brand-strong">
              <Layers size={16} /> Flashcards from this file
            </Link>
          )}
          {/* Same slot either way, so the result message survives the refresh that creates the deck. */}
          <MaterialCardsButton fileId={id} label={deck ? "Make more cards" : "Make flashcards from this file"} />
        </div>
      )}

      {file.status === "failed" && <p className="mt-3 rounded-xl bg-danger/10 p-3 text-sm text-danger">Processing failed: {file.error}</p>}
      {inProgress && (
        <details className="mt-3 rounded-2xl border border-brand/30 bg-brand-soft/30 p-4 text-sm" open>
          <summary className="cursor-pointer font-semibold text-brand-strong">
            Being read in the background: page {reading!.cursor} of {reading!.totalPages}
          </summary>
          <p className="mt-1 mb-3 text-xs text-muted">Keep Lengible open (any page) and it carries on. Live progress:</p>
          <div className="text-xs">
            <ProcessDetails fileId={id} />
          </div>
        </details>
      )}
      {(outline ?? []).length > 0 && (
        <details className="mt-3 rounded-2xl border border-border bg-surface p-4" open={(outline ?? []).length <= 6}>
          <summary className="cursor-pointer font-semibold">Topics in this file ({outline!.length})</summary>
          <ol className="mt-3 space-y-3 text-sm">
            {outline!.map((o) => (
              <li key={o.topic_id}>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{topicName.get(o.topic_id) ?? "Topic"}</span>
                  {o.start_page && (
                    <Link href={`/library/file/${id}?page=${o.start_page}`} className="text-xs text-brand underline">
                      pages {o.start_page}
                      {o.end_page && o.end_page !== o.start_page ? `–${o.end_page}` : ""}
                    </Link>
                  )}
                </p>
                {o.subtopics.length > 0 && <p className="text-xs text-muted">{o.subtopics.slice(0, 10).join(" · ")}</p>}
                {o.key_points.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                    {o.key_points.slice(0, 6).map((k) => (
                      <li key={k}>{k}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
      {needsReview && (
        <Link href={`/library/file/${id}/review`} className="mt-3 block rounded-xl bg-brand-soft p-3 text-sm font-medium text-brand-strong">
          Lengible found {file.doc_type === "timetable" ? "sessions and exam dates" : "topics"} in this file. Tap to review and import →
        </Link>
      )}
      {!needsReview && importableTypes.includes(file.doc_type) && file.analysis != null && (
        <Link href={`/library/file/${id}/review`} className="mt-3 inline-block text-sm text-brand underline">
          See what was imported from this file
        </Link>
      )}

      {concepts.length > 0 && (
        <Card className="mt-4">
          <h2 className="mb-2 text-sm font-semibold">Mentioned in this file — tap to see every course that covers it</h2>
          <div className="space-y-2">
            {[...byKind.entries()].map(([kind, list]) => (
              <div key={kind}>
                <p className="mb-1 text-xs text-muted">{kindLabel[kind]}</p>
                <div className="flex flex-wrap gap-1.5">
                  {list.map((l) => (
                    <Link key={l.concepts.id} href={`/library/concept/${l.concepts.id}`} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-strong">
                      {l.concepts.name}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-4 flex gap-1 rounded-xl bg-surface-2 p-1 text-sm font-medium">
        {[
          ["view", "View"],
          ["text", "Text"],
          ["details", "Details & edit"],
        ].map(([t, label]) => (
          <Link key={t} href={tabHref(t)} className={cx("flex-1 rounded-lg py-2 text-center", tab === t ? "bg-surface text-brand shadow-sm" : "text-muted")}>
            {label}
          </Link>
        ))}
      </div>

      <Card className="mt-3 overflow-hidden p-0">
        {tab === "view" &&
          (isPdf && viewUrl ? (
            <PdfViewer url={viewUrl} startPage={startPage} />
          ) : isImage && viewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={viewUrl} alt={file.name} className="mx-auto max-h-[80dvh] w-auto" />
          ) : (
            <p className="p-4 text-sm text-muted">
              This type can&apos;t be shown inside Lengible. Use <b>Open in another app</b> (e.g. WPS), or the <b>Text</b> tab to read the words.
            </p>
          ))}

        {tab === "text" && (
          <div className="divide-y divide-border">
            {chunks?.length ? (
              chunks.map((c) => (
                <div key={c.page} id={`p${c.page}`} className="p-4">
                  <p className="mb-1 text-xs font-semibold text-muted">{file.storage_path.endsWith(".pptx") ? "Slide" : "Page"} {c.page}</p>
                  <LinkedText text={c.content} concepts={concepts.map((l) => l.concepts)} />
                </div>
              ))
            ) : (
              <p className="p-4 text-sm text-muted">No text saved for this file{file.status === "no_text" ? " yet — tap “Read with AI” above" : ""}.</p>
            )}
          </div>
        )}

        {tab === "details" && (
          <div className="p-4">
            <form action={updateFile} className="space-y-4">
              <input type="hidden" name="id" value={file.id} />
              <Field label="Name">
                <input name="name" defaultValue={file.name} required className={inputClass} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type">
                  <select name="doc_type" defaultValue={file.doc_type} className={inputClass}>
                    {docTypes.map((d) => (
                      <option key={d.value} value={d.value}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Course">
                  <select name="course_id" defaultValue={file.course_id ?? ""} className={inputClass}>
                    <option value="">General (all courses)</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parent_id ? "— " : ""}
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Folder" hint="Folders of the chosen course. Change the course and save first to see its folders.">
                  <select name="folder_id" defaultValue={file.folder_id ?? ""} className={inputClass}>
                    <option value="">— Top level —</option>
                    {(folders ?? [])
                      .filter((f) => f.course_id === file.course_id)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Topic">
                  <select name="topic_id" defaultValue={file.topic_id ?? ""} className={inputClass}>
                    <option value="">— None —</option>
                    {(topics ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {courses.find((c) => c.id === t.course_id)?.short_name ?? ""} · {t.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Button type="submit">Save changes</Button>
            </form>
            <form action={deleteFile} className="mt-8 border-t border-border pt-4">
              <input type="hidden" name="id" value={file.id} />
              <ConfirmButton message={`Delete “${file.name}”? This removes the file and its saved text.`} variant="danger">
                <Trash2 size={16} /> Delete file
              </ConfirmButton>
            </form>
          </div>
        )}
      </Card>
    </>
  );
}
