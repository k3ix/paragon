import { useState } from "react";

export function DataActions({ month }: { month: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function backup() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { sizeBytes: number };
      setStatus(`Backed up ${Math.round(body.sizeBytes / 1024)} KB.`);
    } catch {
      setStatus("Backup failed. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 flex flex-wrap items-center gap-3 border-t border-ink-700 pt-6 text-sm">
      <span className="text-xs uppercase tracking-widest text-ink-300">Your data</span>

      {/* Plain links: the server sets content-disposition, so no JavaScript is needed. */}
      <a
        href={`/api/export.csv?month=${month}`}
        className="rounded border border-ink-700 px-3 py-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
      >
        This month as CSV
      </a>
      <a
        href="/api/export.json"
        className="rounded border border-ink-700 px-3 py-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100"
      >
        Everything as JSON
      </a>

      <button
        type="button"
        onClick={backup}
        disabled={busy}
        className="rounded border border-ink-700 px-3 py-1.5 text-ink-300 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50"
      >
        {busy ? "Backing up…" : "Back up now"}
      </button>

      {status && <span className="text-xs text-ink-300">{status}</span>}
    </section>
  );
}
