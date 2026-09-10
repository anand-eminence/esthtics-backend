import { requireSession } from "@/lib/auth";
import { json, notFound, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { percent } from "@/lib/serialize";

export const OPTIONS = preflight;

const RECENT_LIMIT = 30;

/** A8 · Member detail — one member's full record. */
export const GET = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;

  const member = await prisma.member.findUnique({ where: { id } });
  if (!member) throw notFound("That member does not exist");

  const [recent, byTheme, correctByTheme, themes, communityTotals, communityCorrect] =
    await Promise.all([
      prisma.answer.findMany({
        where: { memberId: id },
        include: { theme: true, question: { select: { prompt: true } } },
        orderBy: [{ quizDate: "desc" }, { slot: "asc" }],
        take: RECENT_LIMIT,
      }),
      // Bonus questions are excluded from the by-theme figures (A8 footnote).
      prisma.answer.groupBy({
        by: ["themeId"],
        where: { memberId: id, isBonus: false },
        _count: { _all: true },
      }),
      prisma.answer.groupBy({
        by: ["themeId"],
        where: { memberId: id, isBonus: false, correct: true },
        _count: { _all: true },
      }),
      prisma.theme.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.answer.count({ where: { isBonus: false } }),
      prisma.answer.count({ where: { isBonus: false, correct: true } }),
    ]);

  const answeredMap = new Map(byTheme.map((r) => [r.themeId, r._count._all]));
  const correctMap = new Map(correctByTheme.map((r) => [r.themeId, r._count._all]));

  const answered = [...answeredMap.values()].reduce((a, b) => a + b, 0);
  const correct = [...correctMap.values()].reduce((a, b) => a + b, 0);

  return json(req, {
    member: {
      id: member.id,
      name: member.name,
      email: member.email,
      circleUid: member.circleUid,
      currentStreak: member.currentStreak,
      longestStreak: member.longestStreak,
      longestStreakEnd: member.longestStreakEnd,
      daysPlayed: member.daysPlayed,
      firstPlayedDate: member.firstPlayedDate,
      lastPlayedDate: member.lastPlayedDate,
      accuracy: percent(correct, answered),
    },
    communityAccuracy: percent(communityCorrect, communityTotals),
    recentAnswers: recent.map((a) => ({
      id: a.id,
      quizDate: a.quizDate,
      slot: a.slot,
      isBonus: a.isBonus,
      themeLabel: a.theme.label,
      prompt: a.question.prompt,
      correct: a.correct,
      streakAtPlay: a.streakAtPlay,
    })),
    byTheme: themes
      .map((t) => ({
        key: t.key,
        label: t.label,
        answered: answeredMap.get(t.id) ?? 0,
        correct: correctMap.get(t.id) ?? 0,
        pct: percent(correctMap.get(t.id) ?? 0, answeredMap.get(t.id) ?? 0),
      }))
      .filter((t) => t.answered > 0)
      .sort((a, b) => b.pct - a.pct),
  });
});
