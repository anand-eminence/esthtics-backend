import { requireSession } from "@/lib/auth";
import { conflict, json, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { inviteSchema } from "@/lib/schemas";

export const OPTIONS = preflight;

/** A10 · Admin users panel. */
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

export const POST = route(async (req) => {
  const session = await requireSession(req);
  const data = inviteSchema.parse(await readJson(req));

  const existing = await prisma.adminUser.findUnique({
    where: { email: data.email },
  });
  if (existing) throw conflict("Someone with that email already has access");

  const user = await prisma.adminUser.create({
    data: {
      ...data,
      role: "ADMINISTRATOR",
      status: "INVITED",
      invitedById: session.sub,
    },
    select: { id: true, name: true, email: true, role: true, status: true },
  });

  // TODO(admin-panel): send the invite email with a set-password link.
  // Until that exists, an administrator sets the password with prisma/seed.ts
  // or `npm run db:studio`.
  return json(req, { user, emailSent: false }, 201);
});
