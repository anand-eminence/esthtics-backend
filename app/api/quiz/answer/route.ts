import { ApiError, notFound, quizJson, quizPreflight, quizRoute, readJson } from "@/lib/http";
import { requireUid, revealPayload, servedQuestions, upsertMember } from "@/lib/quiz";
import { getSettings, today } from "@/lib/settings";
import { recordAnswer } from "@/lib/streak";

export const OPTIONS = quizPreflight;

/**
 * Q4/Q5 — one answer, submitted the moment it is tapped.
 *
 * This is the only endpoint that ever reveals a correct answer, and only for
 * the question the member has just answered herself.
 */
export const POST = quizRoute(async (req) => {
  const body = await readJson<{
    uid?: string;
    email?: string;
    name?: string;
    questionId?: string;
    selectedIndex?: number;
  }>(req);

  const uid = requireUid(body.uid);
  const questionId = String(body.questionId || "").trim();
  const selectedIndex = Number(body.selectedIndex);

  if (!questionId) throw new ApiError("questionId is required", 400);
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0) {
    throw new ApiError("selectedIndex must be a non-negative integer", 400);
  }

  const settings = await getSettings();
  const quizDate = await today();

  // Only a live day has served questions, so anything not among today's —
  // another date, or a day that isn't published — is not part of the quiz.
  const todaysQuestions = await servedQuestions(quizDate);
  const question = todaysQuestions.find((q) => q.id === questionId);

  if (!question) {
    throw notFound("This question is not part of today's quiz");
  }
  if (selectedIndex >= question.options.length) {
    throw new ApiError("selectedIndex is out of range", 400);
  }
  if (question.isBonus && !settings.bonusEnabled) {
    throw new ApiError("The bonus question is not being offered", 400);
  }

  const member = await upsertMember({ uid, email: body.email, name: body.name });

  const outcome = await recordAnswer({
    memberId: member.id,
    question,
    selectedIndex,
    quizDate,
    requiredCount: todaysQuestions.filter((q) => !q.isBonus).length,
    bonusOffered: todaysQuestions.some((q) => q.isBonus) && settings.bonusEnabled,
  });

  return quizJson(req, {
    alreadyAnswered: outcome.alreadyAnswered,
    questionId: question.id,
    slot: question.slot,
    isBonus: question.isBonus,
    theme: { key: question.theme.key, label: question.theme.label },
    selectedIndex: outcome.selectedIndex,
    correct: outcome.correct,
    correctIndex: question.correctIndex,
    ...revealPayload(question, settings.defaultGoDeeperUrl),
    progress: outcome.progress,
    streak: {
      current: outcome.currentStreak,
      longest: outcome.longestStreak,
      atPlay: outcome.streakAtPlay,
    },
  });
});
