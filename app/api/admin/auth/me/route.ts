import { requireSession } from "@/lib/auth";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const OPTIONS = preflight;

export const GET = route(async (req) => {
  const session = await requireSession(req);
  const user = await prisma.adminUser.findUniqueOrThrow({
    where: { id: session.sub },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      lastLoginAt: true,
    },
  });
  return json(req, { user });
});
