import { err, ok, type Result } from "../result.js";

export interface User {
  id: string;
  email: string;
}

export function parseUser(raw: string): Result<User> {
  const parsed = JSON.parse(raw) as Partial<User>;
  if (!parsed.id || !parsed.email) {
    return err("user requires id and email");
  }
  return ok({ id: parsed.id, email: parsed.email });
}

export function normalizeEmail(user: User): Result<User> {
  if (!user.email.includes("@")) {
    return err("invalid email");
  }
  return ok({ ...user, email: user.email.toLowerCase() });
}
