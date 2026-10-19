"use client";

import { useState } from "react";
import { FolderPlus, Pencil, Trash2, Upload } from "lucide-react";
import { createFolder, deleteFolder, renameFolder } from "@/app/(app)/library/actions";
import { Button, Card, inputClass, cx } from "@/components/ui";
import { UploadPanel } from "./upload-panel";

export function LibraryToolbar({
  courseId,
  folder,
  topics,
}: {
  courseId: string | null;
  folder: { id: string; name: string } | null;
  topics: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState<"upload" | "folder" | "rename" | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setOpen(open === "upload" ? null : "upload")}>
          <Upload size={16} /> Upload
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(open === "folder" ? null : "folder")}>
          <FolderPlus size={16} /> New folder
        </Button>
        {folder && (
          <>
            <Button type="button" variant="ghost" onClick={() => setOpen(open === "rename" ? null : "rename")}>
              <Pencil size={16} /> Rename
            </Button>
            <form
              action={deleteFolder}
              onSubmit={(e) => {
                if (!confirm(`Delete the folder “${folder.name}” and its subfolders? Files inside move up to the top level.`)) e.preventDefault();
              }}
            >
              <input type="hidden" name="id" value={folder.id} />
              <Button type="submit" variant="ghost" className="text-danger">
                <Trash2 size={16} /> Delete folder
              </Button>
            </form>
          </>
        )}
      </div>

      {open === "upload" && <UploadPanel courseId={courseId} folderId={folder?.id ?? null} topics={topics} onClose={() => setOpen(null)} />}

      {(open === "folder" || open === "rename") && (
        <Card>
          <form action={open === "folder" ? createFolder : renameFolder} onSubmit={() => setTimeout(() => setOpen(null), 0)} className="flex gap-2">
            {open === "folder" ? (
              <>
                <input type="hidden" name="course_id" value={courseId ?? ""} />
                <input type="hidden" name="parent_id" value={folder?.id ?? ""} />
              </>
            ) : (
              <input type="hidden" name="id" value={folder!.id} />
            )}
            <input
              name="name"
              required
              autoFocus
              defaultValue={open === "rename" ? folder!.name : ""}
              placeholder={folder ? `New folder inside ${folder.name}` : "Folder name, e.g. Practicals"}
              className={cx(inputClass, "flex-1")}
            />
            <Button type="submit">{open === "folder" ? "Create" : "Save"}</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
