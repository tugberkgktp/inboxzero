// Shapes returned by the InboxZero API. Kept in sync with the backend manually
// (a shared package would be the next step in a larger monorepo).

export type JobStatus = "processing" | "completed";
export type ItemStatus = "queued" | "processing" | "done" | "failed";

export interface StatusCounts {
  queued: number;
  processing: number;
  done: number;
  failed: number;
}

export interface JobSummary {
  id: string;
  status: JobStatus;
  totalItems: number;
  createdAt: string;
  counts: StatusCounts;
}

export interface Item {
  id: string;
  status: ItemStatus;
  attempts: number;
  inputText: string;
  category: string | null;
  priority: number | null;
  sentiment: string | null;
  summary: string | null;
  suggestedReply: string | null;
  error: string | null;
  updatedAt: string;
}

export interface JobDetail extends JobSummary {
  items: Item[];
}

export interface AuthResponse {
  user: { id: string; email: string };
  token: string;
}
