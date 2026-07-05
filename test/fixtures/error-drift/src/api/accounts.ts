import { err, ok, type Result } from "../result.js";
import type { User } from "./users.js";

export function activateAccount(user: User): Result<User> {
  if (user.id === "") {
    return err("missing account id");
  }
  return ok(user);
}

export function suspendAccount(user: User): Result<User> {
  if (user.id === "") {
    return err("missing account id");
  }
  return ok({ ...user, email: `suspended+${user.email}` });
}

export function deleteAccount(user: User): User {
  if (user.id === "") {
    throw new Error("missing account id");
  }
  return user;
}
