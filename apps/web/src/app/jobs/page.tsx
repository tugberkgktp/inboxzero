"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateJob, useJobs } from "@/lib/queries";
import { useRequireAuth } from "@/lib/useAuth";
import { Nav, StatusBadge } from "../components";
import type { ApiError } from "@/lib/api";

const SAMPLE = `App crashes every time I open the settings page
I was charged twice this month, please refund one
It would be great if you added a dark mode
Thanks for the quick support, you're awesome!
FAIL this item always errors (demo of retries)`;

export default function JobsPage() {
  const ready = useRequireAuth();
  const router = useRouter();
  const jobs = useJobs();
  const createJob = useCreateJob();
  const [text, setText] = useState(SAMPLE);

  if (!ready) return null;

  const itemCount = text.split("\n").filter((l) => l.trim()).length;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createJob.mutate(text, {
      // Jump straight to the new job to watch it process live.
      onSuccess: (job) => router.push(`/jobs/${job.id}`),
    });
  };

  return (
    <main>
      <Nav />

      <form className="card" onSubmit={onSubmit}>
        <h2>New batch</h2>
        <p style={{ color: "#666", marginTop: 0 }}>
          One item per line. The API enqueues them and returns immediately.
        </p>
        <textarea
          rows={7}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ marginTop: 10 }}>
          <button type="submit" disabled={createJob.isPending || itemCount === 0}>
            {createJob.isPending ? "Submitting…" : `Submit ${itemCount} items`}
          </button>
        </div>
        {createJob.error && (
          <p className="error">{(createJob.error as ApiError).message}</p>
        )}
      </form>

      <div className="card">
        <h2>Your jobs</h2>
        {jobs.isLoading && <p>Loading…</p>}
        {jobs.error && (
          <p className="error">{(jobs.error as ApiError).message}</p>
        )}
        {jobs.data?.length === 0 && <p>No jobs yet. Submit a batch above.</p>}
        {jobs.data && jobs.data.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Created</th>
                <th>Status</th>
                <th>Items</th>
                <th>Progress (done / failed)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.map((job) => (
                <tr key={job.id}>
                  <td>{new Date(job.createdAt).toLocaleTimeString()}</td>
                  <td>
                    <StatusBadge status={job.status} />
                  </td>
                  <td>{job.totalItems}</td>
                  <td>
                    {job.counts.done} done / {job.counts.failed} failed
                  </td>
                  <td>
                    <a href={`/jobs/${job.id}`}>View</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
