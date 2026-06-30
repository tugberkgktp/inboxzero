// Client-side auth guard. Redirects to /login when no token is present.
// Returns `ready` so guarded pages can avoid rendering until the check runs
// (prevents a flash of protected content and SSR/localStorage mismatch).
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "./api";

export function useRequireAuth() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
    } else {
      setReady(true);
    }
  }, [router]);

  return ready;
}
