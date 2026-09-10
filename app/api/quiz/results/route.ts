import { quizJson, quizPreflight, quizRoute } from "@/lib/http";
import { isValidDate } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { requireUid } from "@/lib/quiz";
import { percent } from "@/lib/serialize";
import { today } from "@/lib/settings";

export const OPTIONS = quizPreflight;

/**
 * Q8 · Results — her score for the day, her updated streak, how she did per
 * theme against the community, and how many members aced it.
 *
 * Bonus answers are excluded from the score and the theme comparison, matching
 * what the screen tells her.
 */
export const GET = quizRoute(async (req) => {
  const url = new URL(req.url);
  const uid = requireUid(url.searchParams.get("uid"));
  const asked = url.searchParams.get("date");
  const quizDate = isValidDate(asked) ? asked : await today();

  const member = await prisma.member.findUnique({ where: { circleUid: uid } });
  if (!member) return quizJson(req, { member: null, results: null });

  const [mine, progress, dayProgress, themes, communityTotals, communityCorrect] = await Promise.all(
    [
      prisma.answer.findMany({
        where: { memberId: member.id, quizDate, isBonus: false },
        include: { theme: true },
        orderBy: { slot: "asc" },
      }),
      prisma.dailyProgress.findUnique({
        where: { memberId_quizDate: { memberId: member.id, quizDate } },
      }),
      prisma.dailyProgress.findMany({
        where: { quizDate },
        select: { correctCount: true, requiredCount: true, completedAt: true },
      }),
      prisma.theme.findMany({ orderBy: { sortOrder: "asc" } }),
      prisma.answer.groupBy({ by: ["themeId"], where: { isBonus: false }, _count: { _all: true } }),
      prisma.answer.groupBy({
        by: ["themeId"],
        where: { isBonus: false, correct: true },
        _count: { _all: true },
      }),
    ],
  );

  const communityTotal = new Map(communityTotals.map((r) => [r.themeId, r._count._all]));
  const communityRight = new Map(communityCorrect.map((r) => [r.themeId, r._count._all]));
  const themeLabel = new Map(themes.map((t) => [t.id, t.label]));

  // Only the themes she actually played today are worth comparing.
  const playedThemes = [...new Set(mine.map((a) => a.themeId))];

  return quizJson(req, {
    date: quizDate,
    member: { uid: member.circleUid, name: member.name },
    results: {
      score: mine.filter((a) => a.correct).length,
      total: mine.length,
      completed: Boolean(progress?.completedAt),
      streak: member.currentStreak,
      previousStreak: Math.max(0, member.currentStreak - 1),
      byTheme: playedThemes.map((themeId) => {
        const answers = mine.filter((a) => a.themeId === themeId);
        return {
          label: themeLabel.get(themeId) ?? "",
          you: percent(answers.filter((a) => a.correct).length, answers.length),
          community: percent(communityRight.get(themeId) ?? 0, communityTotal.get(themeId) ?? 0),
        };
      }),
      community: {
        played: dayProgress.length,
        aced: dayProgress.filter(
          (p) => p.completedAt && p.requiredCount > 0 && p.correctCount === p.requiredCount,
        ).length,
      },
    },
  });
});
