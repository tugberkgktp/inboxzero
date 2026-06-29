// Auth primitives: password hashing + JWT signing/verifying.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { env } from "../env";
import { conflict, unauthorized } from "../lib/errors";

export interface JwtPayload {
  userId: string;
  email: string;
}

export async function register(email: string, password: string) {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw conflict("Email already registered.");

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true, email: true },
  });
  return { user, token: sign({ userId: user.id, email: user.email }) };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw unauthorized("Invalid email or password.");

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw unauthorized("Invalid email or password.");

  return {
    user: { id: user.id, email: user.email },
    token: sign({ userId: user.id, email: user.email }),
  };
}

function sign(payload: JwtPayload): string {
  const options: jwt.SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verify(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    throw unauthorized("Invalid or expired token.");
  }
}
