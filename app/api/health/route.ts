import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const OPTIONS = preflight;

export const GET = route(async (req) => {
  let database = "up";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "down";
  }
  return json(
    req,
    { ok: database === "up", database },
    database === "up" ? 200 : 503,
  );
});
