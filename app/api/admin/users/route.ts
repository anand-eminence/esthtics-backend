import { requireSession } from "@/lib/auth";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const OPTIONS = preflight;

/** A10 · Admin users panel. Read only — the panel has a single administrator,
 *  created by prisma/seed.ts, so there is no way to add accounts from here. */
export const GET = route(async (req) => {
  await requireSession(req);
  const users = await prisma.adminUser.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  return json(req, { users });
});
