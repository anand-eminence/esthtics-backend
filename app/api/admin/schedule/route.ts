import { requireSession } from "@/lib/auth";
import { isValidDate, weekOf } from "@/lib/date";
import { json, preflight, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { featuredRow } from "@/lib/serialize";
import { getSettings, today } from "@/lib/settings";

export const OPTIONS = preflight;

/** A5 · Schedule — one week at a glance, with the empty slots called out. */
export const GET = route(async (req) => {
  await requireSession(req);

  const asked = new URL(req.url).searchParams.get("week");
  const anchor = isValidDate(asked) ? asked : await today();
  const days = weekOf(anchor);
  const settings = await getSettings();

  const [questions, featured] = await Promise.all([
    prisma.question.findMany({
      where: { quizDate: { in: days }, status: { not: "ARCHIVED" } },
      include: { theme: true },
      orderBy: [{ quizDate: "asc" }, { slot: "asc" }],
    }),
    prisma.featuredContent.findMany({
      where: { quizDate: { in: days } },
      orderBy: { quizDate: "asc" },
    }),
  ]);

  const byDate = new Map<string, typeof questions>();
  for (const q of questions) {
    const list = byDate.get(q.quizDate) ?? [];
    list.push(q);
    byDate.set(q.quizDate, list);
  }

  const week = days.map((date) => {
    const dayQuestions = byDate.get(date) ?? [];
    const slots = Array.from({ length: settings.questionsPerDay }, (_, i) => {
      const slot = i + 1;
      const found = dayQuestions.find((q) => q.slot === slot);
      return found
        ? {
            slot,
            state: "filled" as const,
            questionId: found.id,
            themeLabel: found.theme.label,
            status: found.status,
          }
        : { slot, state: "empty" as const, questionId: null, themeLabel: null, status: null };
    });
    const bonus = dayQuestions.find((q) => q.isBonus);

    return {
      date,
      slots,
      bonus: bonus
        ? { questionId: bonus.id, themeLabel: bonus.theme.label, status: bonus.status }
        : null,
      filledCount: slots.filter((s) => s.state === "filled").length,
      isComplete: slots.every((s) => s.state === "filled"),
    };
  });

  return json(req, {
    weekStart: days[0],
    weekEnd: days[6],
    timezone: settings.timezone,
    questionsPerDay: settings.questionsPerDay,
    week,
    featured: featured.map(featuredRow),
  });
});
