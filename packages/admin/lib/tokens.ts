import "server-only";
import { randomBytes } from "node:crypto";

// Токен-приглашение для deep-link t.me/<bot>?start=<token>
export function generateInviteToken(): string {
  return randomBytes(12).toString("base64url");
}
