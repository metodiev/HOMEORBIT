"use client";

import { useCallback, useEffect, useState } from "react";

type Job = {
  id: string;
  operation: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  prompt: string;
  workflowName: string | null;
  resultUrl: string | null;
  computedQueuePosition: number | null;
  created_at: string;
};

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function ImageJobMonitor({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/images/jobs?limit=12", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { jobs?: Job[] };
      setJobs(payload.jobs ?? []);
      setError(null);
    } catch {
      setError("Live job updates are temporarily unavailable.");
    }
  }, []);

  useEffect(() => {
    const active = jobs.some((job) => job.status === "queued" || job.status === "running");
    if (!active) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [jobs, load]);

  async function cancel(jobId: string) {
    const response = await fetch(`/api/images/jobs/${jobId}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "Could not cancel that job.");
      return;
    }
    await load();
  }

  if (jobs.length === 0) {
    return <p className="text-sm text-ink-soft">No image jobs yet. Generate or edit an image to start the local queue.</p>;
  }

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p> : null}
      {jobs.map((job) => (
        <article key={job.id} className="rounded-2xl border border-black/5 bg-white/70 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-ink">
                {job.operation.replace(/_/g, " ")} · {STATUS_LABEL[job.status]}
              </p>
              <p className="text-[11px] text-ink-soft">
                {job.workflowName ?? "workflow deleted"} · {new Date(job.created_at).toLocaleString()}
                {job.computedQueuePosition && job.computedQueuePosition > 0 ? ` · queue #${job.computedQueuePosition}` : ""}
              </p>
            </div>
            {job.status === "queued" ? (
              <button type="button" onClick={() => void cancel(job.id)} className="btn-ghost px-2 py-1 text-[11px]">
                Cancel
              </button>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-3 text-xs text-ink">{job.prompt}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sand">
            <div
              className={`h-full transition-all ${job.status === "failed" ? "bg-red-400" : job.status === "succeeded" ? "bg-emerald-500" : "bg-teal"}`}
              style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
            />
          </div>
          {job.error ? <p className="mt-2 text-xs text-red-700">{job.error}</p> : null}
          {job.resultUrl ? (
            <div className="mt-3 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={job.resultUrl} alt={job.prompt} className="h-28 w-28 rounded-xl object-cover" />
              <a href={`${job.resultUrl}?download=1`} className="btn-secondary px-2 py-1 text-[11px]">
                Download
              </a>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
