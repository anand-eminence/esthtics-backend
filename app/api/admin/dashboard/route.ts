import { requireSession } from "@/lib/auth";
import { addDays } from "@/lib/date";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { percent } from "@/lib/serialize";
import { getSettings, today } from "@/lib/settings";

export const OPTIONS = preflight;

const LOOKAHEAD_DAYS = 14;
const SCHEDULED_AHEAD = 5;

/** A2 · Dashboard — is today set up, and is anything missing in the days ahead. */
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
      where: { quizDate: date, status: { not: "ARCHIVED" } },
      include: { theme: true, _count: { select: { answers: true } } },
      orderBy: { slot: "asc" },
    }),
    prisma.question.findMany({
      where: { quizDate: { in: upcoming }, status: { not: "ARCHIVED" } },
      select: { quizDate: true, slot: true, isBonus: true, status: true },
    }),
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

  const byDate = new Map<
    string,
    { slots: Set<number>; bonus: boolean; anyDraft: boolean }
  >();
  for (const q of aheadQuestions) {
    const entry = byDate.get(q.quizDate) ?? {
      slots: new Set<number>(),
      bonus: false,
      anyDraft: false,
    };
    if (q.isBonus) entry.bonus = true;
    else entry.slots.add(q.slot);
    if (q.status === "DRAFT") entry.anyDraft = true;
    byDate.set(q.quizDate, entry);
  }

  const needsAttention: Array<{
    date: string;
    severity: "empty" | "incomplete";
    filled: number;
    required: number;
    missingSlots: number[];
    hasDraft: boolean;
  }> = [];

  for (const day of upcoming) {
    const entry = byDate.get(day);
    const filled = entry ? entry.slots.size : 0;
    if (filled >= settings.questionsPerDay && !entry?.anyDraft) continue;

    const missingSlots = Array.from(
      { length: settings.questionsPerDay },
      (_, i) => i + 1,
    ).filter((slot) => !entry?.slots.has(slot));
    needsAttention.push({
      date: day,
      severity: filled === 0 ? "empty" : "incomplete",
      filled,
      required: settings.questionsPerDay,
      missingSlots,
      hasDraft: Boolean(entry?.anyDraft),
    });
  }

  const scheduledAhead = upcoming.slice(0, SCHEDULED_AHEAD).map((day) => {
    const entry = byDate.get(day);
    return {
      date: day,
      questionCount: entry ? entry.slots.size : 0,
      hasBonus: Boolean(entry?.bonus),
      isComplete: (entry?.slots.size ?? 0) >= settings.questionsPerDay,
    };
  });

  return json(req, {
    date,
    timezone: settings.timezone,
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
        status: q.status,
      };
    }),
    needsAttention,
    scheduledAhead,
  });
});
