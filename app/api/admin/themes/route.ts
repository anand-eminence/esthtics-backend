import { requireSession } from "@/lib/auth";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const OPTIONS = preflight;

export const GET = route(async (req) => {
  await requireSession(req);
  const themes = await prisma.theme.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { id: true, key: true, label: true, sortOrder: true },
  });
  return json(req, { themes });
});
