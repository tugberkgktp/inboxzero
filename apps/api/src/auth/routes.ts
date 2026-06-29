// Auth routes: POST /auth/register, POST /auth/login.
import { Router } from "express";
import { z } from "zod";
import { register, login } from "./service";
import { badRequest } from "../lib/errors";

export const authRouter = Router();

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0].message);
    const result = await register(parsed.data.email, parsed.data.password);
    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0].message);
    const result = await login(parsed.data.email, parsed.data.password);
    res.json(result);
  } catch (e) {
    next(e);
  }
});
