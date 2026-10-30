"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Download, FileText, Folder, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { DriveItem } from "@/lib/supabase/types";
import { checkDriveLink, setAutoImport, setFolderCourse, updateDriveItem } from "@/app/(app)/library/drive/actions";
import { useBackgroundWork } from "@/components/background-work";
import { docTypes, formatBytes } from "@/lib/library";
import { Button, Card, cx, inputClass } from "@/components/ui";

type Course = { id: string; name: string };
const statusChip: Record<DriveItem["status"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-brand-soft text-brand-strong" },
  changed: { label: "Changed in Drive", cls: "bg-warn/15 text-warn" },
  imported: { label: "In your Library", cls: "bg-ok/15 text-ok" },
  skipped: { label: "Can't be read", cls: "bg-surface-2 text-muted" },
  error: { label: "Problem", cls: "bg-danger/10 text-danger" },
  removed: { label: "No longer in the link", cls: "bg-surface-2 text-muted" },
};

export function DriveTree({ sourceId, items: initial, courses, autoImport }: { sourceId: string; items: DriveItem[]; courses: Course[]; autoImport: boolean }) {
  const router = useRouter();
  const { addDriveImports, jobs } = useBackgroundWork();
  // Your ticks and choices made on this page, laid over the latest list from the server
  // (so a refresh after "Check for changes" shows new files without losing anything).
  const [overrides, setOverrides] = useState<Record<string, Partial<DriveItem>>>({});
  const items = initial.map((i) => (overrides[i.id] ? { ...i, ...overrides[i.id] } : i));
  const setItems = (fn: (cur: DriveItem[]) => DriveItem[]) => {
    const next = fn(items);
    setOverrides((o) => {
      const copy = { ...o };
      next.forEach((n, k) => {
        if (n !== items[k]) copy[n.id] = { ...copy[n.id], include: n.include, doc_type: n.doc_type, course_id: n.course_id };
      });
      return copy;
    });
  };
  const [filter, setFilter] = useState<"todo" | "all" | "lib" | "skip">(initial.some((i) => i.status === "new" || i.status === "changed") ? "todo" : "all");
  const [checking, startCheck] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const [auto, setAuto] = useState(autoImport);

  const patch = (id: string, p: Partial<DriveItem>) => {
    setItems((cur) => cur.map((i) => (i.id === id ? { ...i, ...p } : i)));
    void updateDriveItem(id, p as never);
  };
  const toBring = items.filter((i) => i.include && (i.status === "new" || i.status === "changed" || i.status === "error"));
  const running = new Set(jobs.filter((j) => j.driveItemId && ["waiting", "uploading", "reading", "analysing"].includes(j.progress.stage)).map((j) => j.driveItemId));

  const shown = items.filter((i) =>
    filter === "all" ? true : filter === "lib" ? i.status === "imported" : filter === "skip" ? i.status === "skipped" || i.status === "removed" || !i.include : i.include && i.status !== "imported" && i.status !== "skipped" && i.status !== "removed",
  );
  // Folder tree: every folder path, with the files directly inside it.
  const folders = (() => {
    const paths = new Set<string>([""]);
    for (const i of shown) {
      const parts = i.path.split("/").filter(Boolean);
      for (let k = 1; k <= parts.length; k++) paths.add(parts.slice(0, k).join("/"));
    }
    return [...paths].sort((a, b) => a.localeCompare(b));
  })();
  const courseOfFolder = (path: string) => {
    const inside = items.filter((i) => i.path === path || i.path.startsWith(`${path}/`));
    const ids = new Set(inside.map((i) => i.course_id ?? ""));
    return ids.size === 1 ? [...ids][0] : "mixed";
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!toBring.length}
            onClick={() => {
              addDriveImports(toBring.map((i) => ({ id: i.id, name: i.name, courseId: i.course_id, changed: i.status === "changed" })));
              setNote({ ok: true, text: `${toBring.length} file${toBring.length === 1 ? "" : "s"} on the way. Follow them in the corner panel; you can leave this page.` });
            }}
          >
            <Download size={16} /> Bring in {toBring.length} file{toBring.length === 1 ? "" : "s"}
          </Button>
          <Button
            variant="secondary"
            disabled={checking}
            onClick={() =>
              startCheck(async () => {
                const r = await checkDriveLink(sourceId);
                setNote(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message! });
                router.refresh();
              })
            }
          >
            {checking ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Check for changes
          </Button>
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              void setAutoImport(sourceId, e.target.checked);
            }}
            className="mt-0.5 size-4 accent-[var(--brand)]"
          />
          <span>
            Bring in new files by themselves
            <span className="block text-xs text-muted">
              Lengible checks this link when you open it (every few hours). Newer versions of files you already have are always refreshed; changed
              timetables and topic lists wait for you to review what changed.
            </span>
          </span>
        </label>
        {note && <p className={cx("text-sm", note.ok ? "text-muted" : "text-danger")}>{note.text}</p>}
      </Card>

      <div className="flex gap-1 overflow-x-auto text-sm font-medium">
        {(
          [
            ["todo", `To bring in (${items.filter((i) => i.include && !["imported", "skipped", "removed"].includes(i.status)).length})`],
            ["lib", `In your Library (${items.filter((i) => i.status === "imported").length})`],
            ["skip", `Left out (${items.filter((i) => i.status === "skipped" || i.status === "removed" || !i.include).length})`],
            ["all", `All (${items.length})`],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} className={cx("shrink-0 rounded-full px-3 py-1.5", filter === k ? "bg-brand text-on-brand" : "bg-surface-2 text-muted")}>
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">Nothing here.</p>
      ) : (
        <Card className="divide-y divide-border p-0">
          {folders.map((path) => {
            const files = shown.filter((i) => i.path === path);
            const depth = path ? path.split("/").length : 0;
            const c = courseOfFolder(path);
            return (
              <div key={path || "top"}>
                {path && (
                  <div className="flex flex-wrap items-center gap-2 bg-surface-2/50 px-4 py-2" style={{ paddingLeft: 16 + (depth - 1) * 14 }}>
                    <Folder size={16} className="shrink-0 text-brand" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{path.split("/").at(-1)}</span>
                    <select
                      value={c === "mixed" ? "mixed" : c}
                      onChange={async (e) => {
                        const v = e.target.value === "" ? null : e.target.value;
                        setItems((cur) => cur.map((i) => (i.path === path || i.path.startsWith(`${path}/`) ? { ...i, course_id: v } : i)));
                        await setFolderCourse(sourceId, path, v);
                      }}
                      className={cx(inputClass, "min-h-8 w-auto max-w-[55%] py-0 text-xs")}
                      aria-label={`Course for ${path}`}
                    >
                      {c === "mixed" && <option value="mixed">Several courses</option>}
                      <option value="">General</option>
                      {courses.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {files.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm" style={{ paddingLeft: 16 + depth * 14 }}>
                    <input
                      type="checkbox"
                      checked={i.include}
                      disabled={i.status === "skipped"}
                      onChange={(e) => patch(i.id, { include: e.target.checked })}
                      className="size-4 shrink-0 accent-[var(--brand)]"
                      aria-label={`Include ${i.name}`}
                    />
                    <FileText size={15} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      {i.file_id && i.status === "imported" ? (
                        <Link href={`/library/file/${i.file_id}`} className="block truncate text-brand underline">
                          {i.name}
                        </Link>
                      ) : (
                        <span className="block truncate">{i.name}</span>
                      )}
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {running.has(i.id) ? (
                          <span className="inline-flex items-center gap-1 text-brand">
                            <Loader2 size={11} className="animate-spin" /> Bringing in…
                          </span>
                        ) : (
                          <span className={cx("rounded-full px-1.5", statusChip[i.status].cls)}>{statusChip[i.status].label}</span>
                        )}
                        {i.size_bytes ? formatBytes(i.size_bytes) : null}
                        {i.error && <span className={i.status === "error" ? "text-danger" : ""}>{i.error}</span>}
                      </span>
                    </span>
                    {i.status !== "skipped" && (
                      <select
                        value={i.doc_type}
                        onChange={(e) => patch(i.id, { doc_type: e.target.value })}
                        className={cx(inputClass, "min-h-8 w-32 py-0 text-xs")}
                        aria-label={`Type of ${i.name}`}
                      >
                        {docTypes.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </Card>
      )}
      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Sparkles size={13} className="mt-0.5 shrink-0" /> Each Drive folder becomes a Library folder under its course. Timetables and topic lists
        are read and then wait for your review; when one changes in Drive you&apos;ll see exactly what changed before anything updates.
      </p>
      {items.some((i) => i.status === "error") && (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <CircleAlert size={13} className="mt-0.5 shrink-0" /> Files marked “Problem” are tried again when you tap Bring in.
        </p>
      )}
      {items.length > 0 && items.every((i) => i.status === "imported" || i.status === "skipped" || !i.include) && (
        <p className="flex items-center gap-1.5 text-sm text-ok">
          <CheckCircle2 size={16} /> Everything you chose is in your Library.
        </p>
      )}
    </div>
  );
}
