// React Query hooks. All server state flows through here so caching,
// invalidation, and polling live in one place.
"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api, setToken } from "./api";
import type { AuthResponse, JobDetail, JobSummary } from "./types";

export const jobKeys = {
  all: ["jobs"] as const,
  detail: (id: string) => ["jobs", id] as const,
};

// --- Auth ---------------------------------------------------------------

export function useAuthMutation(kind: "login" | "register") {
  return useMutation({
    mutationFn: (creds: { email: string; password: string }) =>
      api<AuthResponse>(`/auth/${kind}`, {
        method: "POST",
        body: creds,
        auth: false,
      }),
    onSuccess: (data) => setToken(data.token),
  });
}

// --- Jobs ---------------------------------------------------------------

export function useJobs() {
  return useQuery({
    queryKey: jobKeys.all,
    queryFn: () => api<JobSummary[]>("/jobs"),
  });
}

/**
 * Job detail with live polling. The refetch interval stops once the job is
 * terminal (completed) so we never poll a finished job forever.
 */
export function useJob(id: string) {
  return useQuery({
    queryKey: jobKeys.detail(id),
    queryFn: () => api<JobDetail>(`/jobs/${id}`),
    refetchInterval: (query) =>
      query.state.data?.status === "completed" ? false : 1500,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (text: string) =>
      api<JobSummary>("/jobs", { method: "POST", body: { text } }),
    // Refresh the jobs list from cache — no full page reload.
    onSuccess: () => qc.invalidateQueries({ queryKey: jobKeys.all }),
  });
}

export function useRetryFailed(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ retried: number }>(`/jobs/${jobId}/retry`, { method: "POST" }),
    // Re-enqueueing flips the job back to processing; refresh detail + list.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: jobKeys.detail(jobId) });
      qc.invalidateQueries({ queryKey: jobKeys.all });
    },
  });
}
