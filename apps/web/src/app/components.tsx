// Small shared presentational pieces used across pages.
"use client";

import { useRouter } from "next/navigation";
import { clearToken } from "@/lib/api";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

export function Nav() {
  const router = useRouter();
  return (
    <div className="nav">
      <h1>
        <a href="/jobs" style={{ textDecoration: "none", color: "inherit" }}>
          InboxZero
        </a>
      </h1>
      <button
        className="secondary"
        onClick={() => {
          clearToken();
          router.replace("/login");
        }}
      >
        Log out
      </button>
    </div>
  );
}
