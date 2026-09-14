import { requireSession } from "@/lib/auth";
import { isValidDate, weekOf } from "@/lib/date";
import { CORE_SLOTS, dayState, liveDates } from "@/lib/days";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { featuredRow } from "@/lib/serialize";
import { getSettings, today } from "@/lib/settings";

export const OPTIONS = preflight;

/** A5 · Schedule — one week at a glance: what each day still needs, and which
 *  days are live. */
export const GET = route(async (req) => {
  await requireSession(req);

  const current = await today();
  const asked = new URL(req.url).searchParams.get("week");
  const days = weekOf(isValidDate(asked) ? asked : current);
  const settings = await getSettings();

  const [questions, featured, live, played] = await Promise.all([
    prisma.question.findMany({
      where: { quizDate: { in: days } },
      include: { theme: true },
      orderBy: [{ quizDate: "asc" }, { slot: "asc" }],
    }),
    prisma.featuredContent.findMany({
      where: { quizDate: { in: days } },
      orderBy: { quizDate: "asc" },
    }),
    liveDates(days),
    prisma.answer.groupBy({
      by: ["quizDate"],
      where: { quizDate: { in: days } },
      _count: { _all: true },
    }),
  ]);

  const playedDates = new Set(played.map((row) => row.quizDate));

  const byDate = new Map<string, typeof questions>();
  for (const q of questions) {
    const list = byDate.get(q.quizDate) ?? [];
    list.push(q);
    byDate.set(q.quizDate, list);
  }

  const week = days.map((date) => {
    const dayQuestions = byDate.get(date) ?? [];
    const slots = CORE_SLOTS.map((slot) => {
      const found = dayQuestions.find((q) => !q.isBonus && q.slot === slot);
      return found
        ? { slot, state: "filled" as const, questionId: found.id, themeLabel: found.theme.label }
        : { slot, state: "empty" as const, questionId: null, themeLabel: null };
    });
    const bonus = dayQuestions.find((q) => q.isBonus);
    const filledCount = slots.filter((s) => s.state === "filled").length;

    return {
      date,
      slots,
      bonus: bonus ? { questionId: bonus.id, themeLabel: bonus.theme.label } : null,
      filledCount,
      isComplete: filledCount === CORE_SLOTS.length,
      state: dayState(filledCount, live.has(date)),
      // Unpublish is only offered until the first answer, and never for a
      // day that has passed.
      hasAnswers: playedDates.has(date),
      isPast: date < current,
    };
  });

  return json(req, {
    weekStart: days[0],
    weekEnd: days[6],
    timezone: settings.timezone,
    week,
    featured: featured.map(featuredRow),
  });
});
