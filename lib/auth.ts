import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { AdminRole } from "@prisma/client";
import { ApiError, unauthorized } from "./http";
import { prisma } from "./prisma";

export const SESSION_COOKIE = "tec_admin_session";

export type Session = {
  sub: string;
  email: string;
  name: string;
  role: AdminRole;
};

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new ApiError("AUTH_SECRET is not configured on the server", 500);
  }
  return new TextEncoder().encode(value);
}

function isHttps(req: Request) {
  const forwarded = req.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0].trim() === "https";
  return new URL(req.url).protocol === "https:";
}

function cookie(req: Request, value: string, maxAgeSeconds: number) {
  const domain = process.env.SESSION_COOKIE_DOMAIN;
  const sameSite = process.env.SESSION_COOKIE_SAMESITE || "Lax";
  const secure = isHttps(req) || sameSite.toLowerCase() === "none";

  return [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
    domain ? `Domain=${domain}` : "",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export function sessionCookie(req: Request, token: string) {
  return cookie(req, token, 60 * 60 * 12);
}

export function clearedSessionCookie(req: Request) {
  return cookie(req, "", 0);
}

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({
    email: session.email,
    name: session.name,
    role: session.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.sub)
    .setIssuedAt()
    .setExpirationTime(process.env.AUTH_TOKEN_TTL || "12h")
    .sign(secret());
}

export async function readSession(token: string): Promise<Session> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return {
      sub: String(payload.sub),
      email: String(payload.email || ""),
      name: String(payload.name || ""),
      role: payload.role as AdminRole,
    };
  } catch {
    throw unauthorized("Your session has expired. Please sign in again.");
  }
}

function tokenFrom(req: Request): string {
  const header = req.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();

  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`),
  );
  return match ? decodeURIComponent(match[1]) : "";
}

const ACCOUNT_TTL_MS = 30_000;

type Account = { checkedAt: number; role: AdminRole; disabled: boolean };
const accounts = new Map<string, Account>();

async function accountFor(id: string): Promise<Account> {
  const cached = accounts.get(id);
  if (cached && Date.now() - cached.checkedAt < ACCOUNT_TTL_MS) return cached;

  const user = await prisma.adminUser.findUnique({
    where: { id },
    select: { status: true, role: true },
  });

  const account: Account = {
    checkedAt: Date.now(),
    role: user?.role ?? "ADMINISTRATOR",
    disabled: !user || user.status === "DISABLED",
  };
  accounts.set(id, account);
  return account;
}

export function forgetAccount(id: string) {
  accounts.delete(id);
}

export async function requireSession(req: Request): Promise<Session> {
  const token = tokenFrom(req);
  if (!token) throw unauthorized();
  const session = await readSession(token);

  const account = await accountFor(session.sub);
  if (account.disabled) throw unauthorized("This account is no longer active");

  return { ...session, role: account.role };
}
