import { requireSession } from "@/lib/auth";
import { conflict, json, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { parseQuery, questionListQuery, questionSchema } from "@/lib/schemas";
import { questionDetail, questionRow, type QuestionWhere } from "@/lib/serialize";

export const OPTIONS = preflight;

/** A3 · Question bank — search, filter, paginate. */
export const GET = route(async (req) => {
  await requireSession(req);
  const q = parseQuery(questionListQuery, req);

  const where: QuestionWhere = {};
  if (q.search) where.prompt = { contains: q.search, mode: "insensitive" };
  if (q.themeId) where.themeId = q.themeId;
  if (q.status) where.status = q.status;
  if (q.slot) where.slot = q.slot;
  if (q.date) {
    // A full day (2026-08-27) or a whole month (2026-08).
    where.quizDate = q.date.length === 10 ? q.date : { startsWith: q.date };
  }

  const [total, rows] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      include: { theme: true },
      orderBy: [{ quizDate: "desc" }, { slot: "asc" }],
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
    }),
  ]);

  return json(req, {
    questions: rows.map(questionRow),
    page: q.page,
    perPage: q.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.perPage)),
  });
});

/** A4 · Add question. */
export const POST = route(async (req) => {
  const session = await requireSession(req);
  const data = questionSchema.parse(await readJson(req));

  const clash = await prisma.question.findUnique({
    where: { quizDate_slot: { quizDate: data.quizDate, slot: data.slot } },
    select: { id: true },
  });
  if (clash) {
    throw conflict(
      `${data.quizDate} already has a question in slot ${data.slot}. Edit that one or pick another slot.`,
    );
  }

  const created = await prisma.question.create({
    data: { ...data, createdById: session.sub, updatedById: session.sub },
    include: { theme: true },
  });

  return json(req, { question: questionDetail(created) }, 201);
});
