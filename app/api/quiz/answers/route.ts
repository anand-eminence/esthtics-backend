import { quizJson, quizPreflight, quizRoute } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { requireUid } from "@/lib/quiz";

export const OPTIONS = quizPreflight;

const LIMIT = 100;

/** One member's saved answers. Used to confirm what was recorded for her. */
export const GET = quizRoute(async (req) => {
  const url = new URL(req.url);
  const uid = requireUid(url.searchParams.get("uid"));
  const quizDate = url.searchParams.get("date") || undefined;

  const member = await prisma.member.findUnique({ where: { circleUid: uid } });
  if (!member) return quizJson(req, { member: null, answers: [] });

  const answers = await prisma.answer.findMany({
    where: { memberId: member.id, ...(quizDate ? { quizDate } : {}) },
    include: {
      theme: { select: { key: true, label: true } },
      question: { select: { prompt: true } },
    },
    orderBy: [{ quizDate: "desc" }, { slot: "asc" }],
    take: LIMIT,
  });

  return quizJson(req, {
    member: {
      uid: member.circleUid,
      email: member.email,
      name: member.name,
      currentStreak: member.currentStreak,
      longestStreak: member.longestStreak,
      daysPlayed: member.daysPlayed,
    },
    answers: answers.map((a) => ({
      id: a.id,
      quizDate: a.quizDate,
      slot: a.slot,
      isBonus: a.isBonus,
      questionId: a.questionId,
      question: a.question.prompt,
      theme: a.theme,
      selectedIndex: a.selectedIndex,
      correct: a.correct,
      streakAtPlay: a.streakAtPlay,
      savedAt: a.createdAt,
    })),
  });
});
