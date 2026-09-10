import { quizJson, quizPreflight, quizRoute } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { memberQuestion, requireUid, servedQuestions, upsertMember } from "@/lib/quiz";
import { getSettings, today } from "@/lib/settings";

export const OPTIONS = quizPreflight;

/**
 * Q1–Q3, Q9, Q10 — everything the quiz needs to open on the right screen.
 *
 * The response carries no correct answers. It also says exactly where she got
 * to, so the client does not have to work out whether this is a fresh start,
 * a resume, or a repeat visit.
 */
export const GET = quizRoute(async (req) => {
  const url = new URL(req.url);
  const uid = requireUid(url.searchParams.get("uid"));

  const settings = await getSettings();
  const quizDate = await today();

  const member = await upsertMember({
    uid,
    email: url.searchParams.get("email"),
    name: url.searchParams.get("name"),
  });

  const [questions, featured, answers, progress] = await Promise.all([
    servedQuestions(quizDate),
    prisma.featuredContent.findUnique({ where: { quizDate } }),
    prisma.answer.findMany({ where: { memberId: member.id, quizDate } }),
    prisma.dailyProgress.findUnique({
      where: { memberId_quizDate: { memberId: member.id, quizDate } },
    }),
  ]);

  const daily = questions.filter((q) => !q.isBonus);
  const bonusQuestion = questions.find((q) => q.isBonus) ?? null;
  const bonusOffered = Boolean(bonusQuestion) && settings.bonusEnabled;

  const answeredBy = new Map(answers.map((a) => [a.questionId, a]));
  const decorate = (q: (typeof questions)[number]) => {
    const prior = answeredBy.get(q.id);
    return {
      ...memberQuestion(q),
      alreadyAnswered: Boolean(prior),
      selectedIndex: prior?.selectedIndex ?? null,
      correct: prior?.correct ?? null,
    };
  };

  const daysQuestions = daily.map(decorate);
  const answeredCount = daysQuestions.filter((q) => q.alreadyAnswered).length;
  const completed = daily.length > 0 && answeredCount >= daily.length;

  return quizJson(req, {
    date: quizDate,
    timezone: settings.timezone,
    member: {
      uid: member.circleUid,
      email: member.email,
      name: member.name,
      currentStreak: member.currentStreak,
      longestStreak: member.longestStreak,
    },
    // Q2 · Start. The header line is derived, not authored — there is no
    // "today's drop" record in this schema.
    today: {
      questionCount: daily.length,
      hasBonus: bonusOffered,
      themes: daily.map((q) => q.theme.label),
    },
    // Q9 · Resume and Q10 · Already played both read from here.
    progress: {
      answeredCount,
      requiredCount: daily.length,
      correctCount: progress?.correctCount ?? 0,
      completed,
      bonusPlayed: progress?.bonusPlayed ?? false,
      nextSlot: daysQuestions.find((q) => !q.alreadyAnswered)?.slot ?? null,
    },
    questions: daysQuestions,
    bonus: bonusOffered && bonusQuestion ? decorate(bonusQuestion) : null,
    // Q6 · Featured content. Only a Live row is shown to members; Draft and
    // Ready are still being worked on in the admin panel.
    featured:
      featured && featured.status === "LIVE"
        ? {
            title: featured.title,
            bodyText: featured.bodyText,
            buttonLabel: featured.buttonLabel,
            linkUrl: featured.linkUrl,
            imageUrl: featured.imageUrl,
          }
        : null,
    joinUrl: settings.joinUrl,
  });
});
