import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const derived = scryptSync(password, salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, "hex");
  if (expectedBuffer.length !== derived.length) return false;
  return timingSafeEqual(derived, expectedBuffer);
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push("At least 10 characters");
  if (!/[a-z]/.test(password)) problems.push("At least one lowercase letter");
  if (!/[A-Z]/.test(password)) problems.push("At least one uppercase letter");
  if (!/\d/.test(password)) problems.push("At least one number");
  return problems;
}
