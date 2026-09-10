import { requireSession } from "@/lib/auth";
import { conflict, json, notFound, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { featuredPatchSchema } from "@/lib/schemas";
import { featuredRow } from "@/lib/serialize";

export const OPTIONS = preflight;

export const GET = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;
  const row = await prisma.featuredContent.findUnique({ where: { id } });
  if (!row) throw notFound("That featured screen no longer exists");
  return json(req, { featured: featuredRow(row) });
});

export const PATCH = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;

  const existing = await prisma.featuredContent.findUnique({ where: { id } });
  if (!existing) throw notFound("That featured screen no longer exists");

  const patch = featuredPatchSchema.parse(await readJson(req));

  if (patch.quizDate && patch.quizDate !== existing.quizDate) {
    const clash = await prisma.featuredContent.findUnique({
      where: { quizDate: patch.quizDate },
      select: { id: true },
    });
    if (clash) throw conflict(`${patch.quizDate} already has a featured screen`);
  }

  const row = await prisma.featuredContent.update({ where: { id }, data: patch });
  return json(req, { featured: featuredRow(row) });
});

export const DELETE = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;
  await prisma.featuredContent.delete({ where: { id } });
  return json(req, { deleted: true });
});
