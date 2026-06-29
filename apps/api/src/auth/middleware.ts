// Auth middleware: extracts and verifies the Bearer JWT, attaches the user to
// the request. Protected routes reject missing/invalid tokens with 401.
import { Request, Response, NextFunction } from "express";
import { verify } from "./service";
import { unauthorized } from "../lib/errors";

// Augment Express's Request type with our auth payload.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; email: string };
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(unauthorized("Missing Bearer token."));
  }
  const payload = verify(header.slice("Bearer ".length));
  req.auth = { userId: payload.userId, email: payload.email };
  next();
}
