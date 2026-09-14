import type { FeaturedContent, Member, Prisma, Question, Theme } from "@prisma/client";

type QuestionWithTheme = Question & { theme: Theme };

/** Shape used by A3 · Question bank rows. `dayLive` belongs to the question's
 *  date — publishing is per day, not per question (lib/days.ts). */
export function questionRow(q: QuestionWithTheme, dayLive: boolean) {
  return {
    id: q.id,
    quizDate: q.quizDate,
    slot: q.slot,
    isBonus: q.isBonus,
    theme: { id: q.theme.id, key: q.theme.key, label: q.theme.label },
    prompt: q.prompt,
    dayLive,
    hasDeepDive: Boolean(q.deepDiveText.trim()),
    updatedAt: q.updatedAt,
  };
}

/** Shape used by A4 · Add or edit question. Includes correctIndex — this
 *  endpoint is admin-only and never reaches a member's browser. `answerCount`
 *  is what locks the options and correct answer once members have played. */
export function questionDetail(q: QuestionWithTheme, dayLive: boolean, answerCount: number) {
  return {
    ...questionRow(q, dayLive),
    themeId: q.themeId,
    options: q.options,
    correctIndex: q.correctIndex,
    displayTag: q.displayTag,
    whyThisMatters: q.whyThisMatters,
    chairLabel: q.chairLabel,
    chairText: q.chairText,
    deepDiveText: q.deepDiveText,
    sourceLabel: q.sourceLabel,
    sourceUrl: q.sourceUrl,
    goDeeperUrl: q.goDeeperUrl,
    internalNotes: q.internalNotes,
    createdAt: q.createdAt,
    answerCount,
  };
}

export function featuredRow(f: FeaturedContent) {
  return {
    id: f.id,
    quizDate: f.quizDate,
    title: f.title,
    bodyText: f.bodyText,
    buttonLabel: f.buttonLabel,
    linkUrl: f.linkUrl,
    imageUrl: f.imageUrl,
    shownAfter: f.shownAfter,
    status: f.status,
    updatedAt: f.updatedAt,
  };
}

export function memberRow(m: Member & { _count?: { answers: number } }) {
  return {
    id: m.id,
    circleUid: m.circleUid,
    name: m.name,
    email: m.email,
    currentStreak: m.currentStreak,
    longestStreak: m.longestStreak,
    daysPlayed: m.daysPlayed,
    lastPlayedDate: m.lastPlayedDate,
    answerCount: m._count?.answers ?? 0,
  };
}

export function percent(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export type QuestionWhere = Prisma.QuestionWhereInput;
