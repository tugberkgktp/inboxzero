"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthMutation } from "@/lib/queries";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthMutation("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { email, password },
      { onSuccess: () => router.replace("/jobs") },
    );
  };

  return (
    <main>
      <h1>Log in</h1>
      <form className="card" onSubmit={onSubmit}>
        <p>
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </p>
        <p>
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </p>
        <button type="submit" disabled={login.isPending}>
          {login.isPending ? "Logging in…" : "Log in"}
        </button>
        {login.error && (
          <p className="error">{(login.error as ApiError).message}</p>
        )}
      </form>
      <p>
        No account? <a href="/register">Register</a>
      </p>
    </main>
  );
}
