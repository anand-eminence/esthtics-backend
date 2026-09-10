import type { DailyProgress } from "@prisma/client";
import { prisma } from "./prisma";
import { previousScheduledDate, type ServedQuestion } from "./quiz";

/**
 * STREAK RULES
 *
 * These were not specified in the proposal. The defaults below are documented
 * so they can be changed in one place once Adam confirms them.
 *
 *  1. A day counts only when the member has answered ALL of that day's
 *     non-bonus questions. Two out of three does not extend the streak.
 *  2. The bonus question never affects score or streak (Q7 says as much on
 *     screen). It is recorded, but excluded from answeredCount/correctCount.
 *  3. A day with nothing scheduled is skipped, not counted as a miss — see
 *     previousScheduledDate(). An empty day is an admin gap, not the member's.
 *  4. No grace period. Miss a scheduled day and the streak restarts at 1.
 */

export type AnswerOutcome = {
  alreadyAnswered: boolean;
  correct: boolean;
  selectedIndex: number;
  streakAtPlay: number;
  currentStreak: number;
  longestStreak: number;
  progress: {
    answeredCount: number;
    requiredCount: number;
    correctCount: number;
    completed: boolean;
    bonusPlayed: boolean;
  };
};

function shape(progress: DailyProgress) {
  return {
    answeredCount: progress.answeredCount,
    requiredCount: progress.requiredCount,
    correctCount: progress.correctCount,
    completed: Boolean(progress.completedAt),
    bonusPlayed: progress.bonusPlayed,
  };
}

export async function recordAnswer(params: {
  memberId: string;
  question: ServedQuestion;
  selectedIndex: number;
  quizDate: string;
  requiredCount: number;
  bonusOffered: boolean;
}): Promise<AnswerOutcome> {
  const {
    memberId,
    question,
    selectedIndex,
    quizDate,
    requiredCount,
    bonusOffered,
  } = params;
  const isBonus = question.isBonus;

  return prisma.$transaction(async (tx) => {
    const member = await tx.member.findUniqueOrThrow({
      where: { id: memberId },
    });

    const existing = await tx.answer.findUnique({
      where: { memberId_questionId: { memberId, questionId: question.id } },
    });

    if (existing) {
      const current = await tx.dailyProgress.findUnique({
        where: { memberId_quizDate: { memberId, quizDate } },
      });
      return {
        alreadyAnswered: true,
        correct: existing.correct,
        selectedIndex: existing.selectedIndex,
        streakAtPlay: existing.streakAtPlay,
        currentStreak: member.currentStreak,
        longestStreak: member.longestStreak,
        progress: current
          ? shape(current)
          : {
              answeredCount: 0,
              requiredCount,
              correctCount: 0,
              completed: false,
              bonusPlayed: false,
            },
      };
    }

    const correct = selectedIndex === question.correctIndex;

    await tx.answer.create({
      data: {
        memberId,
        questionId: question.id,
        themeId: question.themeId,
        quizDate,
        slot: question.slot,
        selectedIndex,
        correct,
        isBonus,
        streakAtPlay: member.currentStreak,
      },
    });

    // Counted atomically, so simultaneous submissions cannot lose an increment.
    const progress = await tx.dailyProgress.upsert({
      where: { memberId_quizDate: { memberId, quizDate } },
      create: {
        memberId,
        quizDate,
        requiredCount,
        answeredCount: isBonus ? 0 : 1,
        correctCount: !isBonus && correct ? 1 : 0,
        bonusOffered,
        bonusPlayed: isBonus,
        streakAfter: member.currentStreak,
      },
      update: {
        requiredCount,
        bonusOffered,
        answeredCount: { increment: isBonus ? 0 : 1 },
        correctCount: { increment: !isBonus && correct ? 1 : 0 },
        ...(isBonus ? { bonusPlayed: true } : {}),
      },
    });

    let currentStreak = member.currentStreak;
    let longestStreak = member.longestStreak;
    let finished = progress;

    const justCompleted =
      !progress.completedAt &&
      progress.requiredCount > 0 &&
      progress.answeredCount >= progress.requiredCount;

    if (justCompleted) {
      const previous = await previousScheduledDate(tx, quizDate);
      const continues = Boolean(
        member.lastPlayedDate && previous && member.lastPlayedDate === previous,
      );

      currentStreak = continues ? member.currentStreak + 1 : 1;
      longestStreak = Math.max(member.longestStreak, currentStreak);

      await tx.member.update({
        where: { id: memberId },
        data: {
          currentStreak,
          longestStreak,
          ...(longestStreak > member.longestStreak
            ? { longestStreakEnd: quizDate }
            : {}),
          lastPlayedDate: quizDate,
          firstPlayedDate: member.firstPlayedDate ?? quizDate,
          daysPlayed: { increment: 1 },
        },
      });

      finished = await tx.dailyProgress.update({
        where: { id: progress.id },
        data: { completedAt: new Date(), streakAfter: currentStreak },
      });
    } else if (!member.firstPlayedDate) {
      await tx.member.update({
        where: { id: memberId },
        data: { firstPlayedDate: quizDate },
      });
    }

    return {
      alreadyAnswered: false,
      correct,
      selectedIndex,
      streakAtPlay: member.currentStreak,
      currentStreak,
      longestStreak,
      progress: shape(finished),
    };
  });
}
