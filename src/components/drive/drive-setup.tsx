// One-time setup: a free Google API key that lets Lengible read links shared "Anyone with the link".
export function DriveSetup({ open }: { open: boolean }) {
  return (
    <details open={open} className="rounded-2xl border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-semibold">{open ? "One-time setup: a free Google API key (about 5 minutes)" : "Google API key setup"}</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5">
        <li>
          Go to <b>console.cloud.google.com</b> and sign in with your Google account. At the top, pick a project or click <b>New project</b>{" "}
          (name it “Lengible”) and open it.
        </li>
        <li>
          In the search bar type <b>Google Drive API</b>, open it and click <b>Enable</b>.
        </li>
        <li>
          Open <b>APIs &amp; Services → Credentials → Create credentials → API key</b>. Copy the key.
        </li>
        <li>
          Recommended: click the new key, under <b>API restrictions</b> choose <b>Restrict key → Google Drive API</b>, and <b>Save</b>.
        </li>
        <li>
          In <b>Vercel → your project → Settings → Environment Variables</b>, add <b>GOOGLE_DRIVE_API_KEY</b> with the key as the value (not marked
          Sensitive is fine; it&apos;s only used on the server). Then <b>Deployments → ⋯ → Redeploy</b>.
        </li>
      </ol>
      <p className="mt-3 text-muted">
        The key only lets Lengible read files that are already shared “Anyone with the link”. It can&apos;t see the rest of your Drive, and it&apos;s
        never sent to your browser. Google doesn&apos;t charge for reading Drive files.
      </p>
    </details>
  );
}
