import { requireSession } from "@/lib/auth";
import { conflict, json, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { featuredSchema } from "@/lib/schemas";
import { featuredRow } from "@/lib/serialize";

export const OPTIONS = preflight;

/** A6 · Featured content. */
export const GET = route(async (req) => {
  await requireSession(req);
  const rows = await prisma.featuredContent.findMany({ orderBy: { quizDate: "desc" } });
  return json(req, { featured: rows.map(featuredRow) });
});

export const POST = route(async (req) => {
  await requireSession(req);
  const data = featuredSchema.parse(await readJson(req));

  const clash = await prisma.featuredContent.findUnique({
    where: { quizDate: data.quizDate },
    select: { id: true },
  });
  if (clash) {
    throw conflict(`${data.quizDate} already has a featured screen. Edit that one instead.`);
  }

  const created = await prisma.featuredContent.create({ data });
  return json(req, { featured: featuredRow(created) }, 201);
});
