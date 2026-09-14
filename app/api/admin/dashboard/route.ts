import { requireSession } from "@/lib/auth";
import { addDays } from "@/lib/date";
import { dayState, liveDates, missingCoreSlots } from "@/lib/days";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { percent } from "@/lib/serialize";
import { getSettings, today } from "@/lib/settings";

export const OPTIONS = preflight;

const LOOKAHEAD_DAYS = 14;
const SCHEDULED_AHEAD = 5;

/** A2 · Dashboard — is today live, and is anything missing in the days ahead. */
export const GET = route(async (req) => {
  await requireSession(req);

  const settings = await getSettings();
  const date = await today();
  const upcoming = Array.from({ length: LOOKAHEAD_DAYS }, (_, i) =>
    addDays(date, i + 1),
  );

  const [
    totalMembers,
    progressToday,
    answersToday,
    topStreak,
    todaysQuestions,
    aheadQuestions,
    live,
  ] = await Promise.all([
    prisma.member.count(),
    prisma.dailyProgress.findMany({
      where: { quizDate: date },
      select: {
        answeredCount: true,
        correctCount: true,
        requiredCount: true,
        completedAt: true,
      },
    }),
    prisma.answer.count({ where: { quizDate: date } }),
    prisma.member.findFirst({
      orderBy: { currentStreak: "desc" },
      select: { name: true, currentStreak: true },
    }),
    prisma.question.findMany({
      where: { quizDate: date },
      include: { theme: true, _count: { select: { answers: true } } },
      orderBy: { slot: "asc" },
    }),
    prisma.question.findMany({
      where: { quizDate: { in: upcoming } },
      select: { quizDate: true, slot: true, isBonus: true },
    }),
    liveDates([date, ...upcoming]),
  ]);

  // Correct-so-far per question needs a second pass; one grouped query covers all of today.
  const correctByQuestion = await prisma.answer.groupBy({
    by: ["questionId"],
    where: { quizDate: date, correct: true },
    _count: { _all: true },
  });
  const correctMap = new Map(
    correctByQuestion.map((r) => [r.questionId, r._count._all]),
  );

  const byDate = new Map<string, { slots: Set<number>; bonus: boolean }>();
  for (const q of aheadQuestions) {
    const entry = byDate.get(q.quizDate) ?? { slots: new Set<number>(), bonus: false };
    if (q.isBonus) entry.bonus = true;
    else entry.slots.add(q.slot);
    byDate.set(q.quizDate, entry);
  }

  // Every upcoming day that isn't live yet, with what it still needs. A day
  // with all three saved is still listed — it reaches nobody until published.
  const needsAttention = upcoming
    .filter((day) => !live.has(day))
    .map((day) => {
      const slots = byDate.get(day)?.slots ?? new Set<number>();
      return {
        date: day,
        state: dayState(slots.size, false),
        filled: slots.size,
        missingSlots: missingCoreSlots(slots),
      };
    });

  const scheduledAhead = upcoming.slice(0, SCHEDULED_AHEAD).map((day) => {
    const filled = byDate.get(day)?.slots.size ?? 0;
    return {
      date: day,
      questionCount: filled,
      hasBonus: Boolean(byDate.get(day)?.bonus),
      state: dayState(filled, live.has(day)),
    };
  });

  const todayCore = todaysQuestions.filter((q) => !q.isBonus).map((q) => q.slot);

  return json(req, {
    date,
    timezone: settings.timezone,
    today: {
      state: dayState(todayCore.length, live.has(date)),
      missingSlots: missingCoreSlots(todayCore),
    },
    stats: {
      playedToday: progressToday.length,
      totalMembers,
      acedToday: progressToday.filter(
        (p) =>
          p.completedAt &&
          p.requiredCount > 0 &&
          p.correctCount === p.requiredCount,
      ).length,
      answersToday,
      longestStreak: topStreak?.currentStreak ?? 0,
      longestStreakMember: topStreak?.name ?? null,
    },
    todaysQuestions: todaysQuestions.map((q) => {
      const answered = q._count.answers;
      return {
        id: q.id,
        slot: q.slot,
        isBonus: q.isBonus,
        theme: { key: q.theme.key, label: q.theme.label },
        prompt: q.prompt,
        answered,
        correctPct: percent(correctMap.get(q.id) ?? 0, answered),
      };
    }),
    needsAttention,
    scheduledAhead,
  });
});
