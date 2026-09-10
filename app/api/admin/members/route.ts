import { requireSession } from "@/lib/auth";
import { addDays } from "@/lib/date";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { percent } from "@/lib/serialize";
import { today } from "@/lib/settings";

export const OPTIONS = preflight;

const SORTS = [
  "currentStreak",
  "longestStreak",
  "daysPlayed",
  "accuracy",
  "lastPlayed",
] as const;
type Sort = (typeof SORTS)[number];

/** A7 · Members. */
export const GET = route(async (req) => {
  await requireSession(req);
  const params = new URL(req.url).searchParams;

  const search = (params.get("search") || "").trim();
  const sortParam = params.get("sort") as Sort | null;
  const sort: Sort =
    sortParam && SORTS.includes(sortParam) ? sortParam : "currentStreak";
  const activity = params.get("activity") || "all"; // all | today | 7d | 30d
  const requestedPage = Math.max(1, Number(params.get("page")) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, Number(params.get("perPage")) || 20),
  );

  const date = await today();
  const since =
    activity === "today"
      ? date
      : activity === "7d"
        ? addDays(date, -6)
        : activity === "30d"
          ? addDays(date, -29)
          : null;

  const where = {
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { email: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(since ? { lastPlayedDate: { gte: since } } : {}),
  };

  const [members, totalAnswers, correctAnswers, playedToday, total] =
    await Promise.all([
      prisma.member.findMany({ where }),
      prisma.answer.groupBy({
        by: ["memberId"],
        where: { isBonus: false },
        _count: { _all: true },
      }),
      prisma.answer.groupBy({
        by: ["memberId"],
        where: { isBonus: false, correct: true },
        _count: { _all: true },
      }),
      prisma.dailyProgress.count({ where: { quizDate: date } }),
      prisma.member.count(),
    ]);

  const answered = new Map(
    totalAnswers.map((r) => [r.memberId, r._count._all]),
  );
  const correct = new Map(
    correctAnswers.map((r) => [r.memberId, r._count._all]),
  );

  const rows = members.map((m) => ({
    id: m.id,
    name: m.name,
    email: m.email,
    currentStreak: m.currentStreak,
    longestStreak: m.longestStreak,
    daysPlayed: m.daysPlayed,
    accuracy: percent(correct.get(m.id) ?? 0, answered.get(m.id) ?? 0),
    lastPlayedDate: m.lastPlayedDate,
  }));

  rows.sort((a, b) => {
    if (sort === "lastPlayed")
      return (b.lastPlayedDate || "").localeCompare(a.lastPlayedDate || "");
    return (b[sort] as number) - (a[sort] as number);
  });

  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const page = Math.min(requestedPage, totalPages);

  return json(req, {
    members: rows.slice((page - 1) * perPage, page * perPage),
    page,
    perPage,
    total: rows.length,
    totalPages,
    summary: { totalMembers: total, playedToday },
  });
});
