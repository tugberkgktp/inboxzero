"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";

// Entry point: send authenticated users to their jobs, others to login.
export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(getToken() ? "/jobs" : "/login");
  }, [router]);
  return null;
}
