"use client";

import { useParams } from "next/navigation";
import { useJob, useRetryFailed } from "@/lib/queries";
import { useRequireAuth } from "@/lib/useAuth";
import { Nav, StatusBadge } from "../../components";
import type { ApiError } from "@/lib/api";

export default function JobDetailPage() {
  const ready = useRequireAuth();
  const { id } = useParams<{ id: string }>();
  const job = useJob(id);
  const retry = useRetryFailed(id);

  if (!ready) return null;

  const data = job.data;
  const hasFailed = (data?.counts.failed ?? 0) > 0;
  const isLive = data?.status === "processing";

  return (
    <main>
      <Nav />
      <p>
        <a href="/jobs">← All jobs</a>
      </p>

      {job.isLoading && <p>Loading…</p>}
      {job.error && <p className="error">{(job.error as ApiError).message}</p>}

      {data && (
        <>
          <div className="card">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <h2 style={{ marginBottom: 4 }}>
                  Job <StatusBadge status={data.status} />{" "}
                  {isLive && (
                    <span style={{ fontSize: "0.8rem", color: "#666" }}>
                      • updating live…
                    </span>
                  )}
                </h2>
                <p style={{ margin: 0, color: "#666" }}>
                  {data.counts.queued} queued · {data.counts.processing}{" "}
                  processing · {data.counts.done} done · {data.counts.failed}{" "}
                  failed
                </p>
              </div>
              <button
                onClick={() => retry.mutate()}
                disabled={!hasFailed || retry.isPending}
                title={
                  hasFailed
                    ? "Re-enqueue failed items"
                    : "No failed items to retry"
                }
              >
                {retry.isPending ? "Retrying…" : "Retry failed"}
              </button>
            </div>
          </div>

          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Input</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Category</th>
                  <th>Priority</th>
                  <th>Sentiment</th>
                  <th>Summary / Error</th>
                  <th>Suggested reply</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td style={{ maxWidth: 180 }}>{item.inputText}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>{item.attempts}</td>
                    <td>{item.category ?? "—"}</td>
                    <td>{item.priority ?? "—"}</td>
                    <td>{item.sentiment ?? "—"}</td>
                    <td style={{ maxWidth: 220 }}>
                      {item.status === "failed" ? (
                        <span className="error">{item.error}</span>
                      ) : (
                        (item.summary ?? "—")
                      )}
                    </td>
                    <td style={{ maxWidth: 220 }}>
                      {item.suggestedReply ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
