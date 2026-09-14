import { requireSession } from "@/lib/auth";
import { TX_OPTIONS, dayInfo, isLive, publishDay } from "@/lib/days";
import { conflict, json, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { parseQuery, questionListQuery, questionSchema } from "@/lib/schemas";
import { questionDetail, questionRow, type QuestionWhere } from "@/lib/serialize";

export const OPTIONS = preflight;

/** A3 · Question bank — search, filter, paginate. */
export const GET = route(async (req) => {
  await requireSession(req);
  const q = parseQuery(questionListQuery, req);

  // Every row's Day column needs this, and the Day filter needs it first.
  const liveDays = prisma.quizDay
    .findMany({ where: { publishedAt: { not: null } }, select: { quizDate: true } })
    .then((rows) => new Set(rows.map((row) => row.quizDate)));

  const where: QuestionWhere = {};
  if (q.search) where.prompt = { contains: q.search, mode: "insensitive" };
  if (q.themeId) where.themeId = q.themeId;
  if (q.slot) where.slot = q.slot;
  if (q.date) {
    // A full day (2026-08-27) or a whole month (2026-08).
    where.quizDate = q.date.length === 10 ? q.date : { startsWith: q.date };
  }
  if (q.day) {
    const live = Array.from(await liveDays);
    where.AND = [{ quizDate: q.day === "live" ? { in: live } : { notIn: live } }];
  }

  const [total, rows, live] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      include: { theme: true },
      orderBy: [{ quizDate: "desc" }, { slot: "asc" }],
      skip: (q.page - 1) * q.perPage,
      take: q.perPage,
    }),
    liveDays,
  ]);

  return json(req, {
    questions: rows.map((row) => questionRow(row, live.has(row.quizDate))),
    page: q.page,
    perPage: q.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / q.perPage)),
  });
});

/** A4 · Add question, optionally publishing its day in the same step. */
export const POST = route(async (req) => {
  const session = await requireSession(req);
  const { publishDay: publish, ...data } = questionSchema.parse(await readJson(req));

  const [clash, live] = await Promise.all([
    prisma.question.findUnique({
      where: { quizDate_slot: { quizDate: data.quizDate, slot: data.slot } },
      select: { id: true },
    }),
    isLive(data.quizDate),
  ]);
  if (clash) {
    throw conflict(
      `${data.quizDate} already has a question in slot ${data.slot}. Edit that one or pick another slot.`,
    );
  }
  // A live day already has its three core questions; only a bonus can join it.
  if (live && !data.isBonus) {
    throw conflict(`${data.quizDate} is live, so only a bonus question can be added to it.`);
  }

  // One transaction, so "Save & publish day" either does both or neither.
  const created = await prisma.$transaction(async (tx) => {
    const question = await tx.question.create({
      data: { ...data, createdById: session.sub, updatedById: session.sub },
      include: { theme: true },
    });
    if (publish) await publishDay(tx, data.quizDate, session.sub);
    return question;
  }, TX_OPTIONS);

  const day = await dayInfo(data.quizDate);
  return json(req, { question: questionDetail(created, day.live, 0), day }, 201);
});
