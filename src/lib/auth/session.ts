import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "./actor";
import { SESSION_COOKIE, actorForSessionToken } from "./session-store";

export async function getCurrentActor(): Promise<Actor | null> {
  const store = await cookies();
  return actorForSessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function setSessionCookie(token: string, expiresAt: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      process.env.SESSION_COOKIE_SECURE !== undefined
        ? process.env.SESSION_COOKIE_SECURE === "true"
        : process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
