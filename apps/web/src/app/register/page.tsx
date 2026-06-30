"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthMutation } from "@/lib/queries";
import { ApiError } from "@/lib/api";

export default function RegisterPage() {
  const router = useRouter();
  const register = useAuthMutation("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    register.mutate(
      { email, password },
      { onSuccess: () => router.replace("/jobs") },
    );
  };

  return (
    <main>
      <h1>Register</h1>
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
          <label>Password (min 6 chars)</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            required
          />
        </p>
        <button type="submit" disabled={register.isPending}>
          {register.isPending ? "Creating…" : "Create account"}
        </button>
        {register.error && (
          <p className="error">{(register.error as ApiError).message}</p>
        )}
      </form>
      <p>
        Have an account? <a href="/login">Log in</a>
      </p>
    </main>
  );
}
