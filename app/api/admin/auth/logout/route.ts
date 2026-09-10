import { clearedSessionCookie } from "@/lib/auth";
import { json, preflight, route } from "@/lib/http";

export const OPTIONS = preflight;

export const POST = route(async (req) =>
  json(req, { ok: true }, 200, {
    headers: { "Set-Cookie": clearedSessionCookie(req) },
  }),
);
