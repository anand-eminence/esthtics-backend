import { requireSession } from "@/lib/auth";
import { isValidDate } from "@/lib/date";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { percent } from "@/lib/serialize";
import { today } from "@/lib/settings";

export const OPTIONS = preflight;

/** A9 · Statistics. Replaces the Summary tab; the report date is changeable. */
export const GET = route(async (req) => {
  await requireSession(req);

  const asked = new URL(req.url).searchParams.get("date");
  const date = isValidDate(asked) ? asked : await today();

  const [progress, answersRecorded, questions, correctByQuestion, themes, themeTotals, themeCorrect] =
    await Promise.all([
      prisma.dailyProgress.findMany({
        where: { quizDate: date },
        select: { correctCount: true, requiredCount: true, completedAt: true },
      }),
      prisma.answer.count({ where: { quizDate: date } }),
      prisma.question.findMany({
        where: { quizDate: date, status: { not: "ARCHIVED" } },
        include: { theme: true, _count: { select: { answers: true } } },
        orderBy: { slot: "asc" },
      }),
      prisma.answer.groupBy({
        by: ["questionId"],
        where: { quizDate: date, correct: true },
        _count: { _all: true },
      }),
      prisma.theme.findMany({ orderBy: { sortOrder: "asc" } }),
      // All-time community average — the number each member is compared against.
      prisma.answer.groupBy({ by: ["themeId"], where: { isBonus: false }, _count: { _all: true } }),
      prisma.answer.groupBy({
        by: ["themeId"],
        where: { isBonus: false, correct: true },
        _count: { _all: true },
      }),
    ]);

  const correctMap = new Map(correctByQuestion.map((r) => [r.questionId, r._count._all]));
  const totalMap = new Map(themeTotals.map((r) => [r.themeId, r._count._all]));
  const correctThemeMap = new Map(themeCorrect.map((r) => [r.themeId, r._count._all]));

  const completed = progress.filter((p) => p.completedAt).length;

  return json(req, {
    date,
    stats: {
      membersPlayed: progress.length,
      acedIt: progress.filter(
        (p) => p.completedAt && p.requiredCount > 0 && p.correctCount === p.requiredCount,
      ).length,
      answersRecorded,
      completionPct: percent(completed, progress.length),
    },
    questions: questions.map((q) => ({
      id: q.id,
      slot: q.slot,
      isBonus: q.isBonus,
      themeLabel: q.theme.label,
      prompt: q.prompt,
      answered: q._count.answers,
      correctPct: percent(correctMap.get(q.id) ?? 0, q._count.answers),
    })),
    communityAverage: themes
      .map((t) => ({
        key: t.key,
        label: t.label,
        answered: totalMap.get(t.id) ?? 0,
        pct: percent(correctThemeMap.get(t.id) ?? 0, totalMap.get(t.id) ?? 0),
      }))
      .sort((a, b) => b.pct - a.pct),
  });
});
