import type { Prisma, Question, Theme } from "@prisma/client";
import { isLive } from "./days";
import { ApiError } from "./http";
import { prisma } from "./prisma";

export type ServedQuestion = Question & { theme: Theme };

export function requireUid(value: string | null | undefined): string {
  const uid = String(value || "").trim();
  if (!uid) throw new ApiError("uid is required", 400);
  return uid;
}

/**
 * Circle is the identity provider — the first time we see a uid we create the
 * member, and we refresh name/email on later visits in case they changed.
 * Blank values never overwrite something we already have.
 */
export async function upsertMember(input: {
  uid: string;
  email?: string | null;
  name?: string | null;
}) {
  const email = String(input.email || "").trim();
  const name = String(input.name || "").trim();

  return prisma.member.upsert({
    where: { circleUid: input.uid },
    create: { circleUid: input.uid, email, name },
    update: { ...(email ? { email } : {}), ...(name ? { name } : {}) },
  });
}

/**
 * The questions members get for a date: every question on it once the day is
 * live, and none before. A half-filled or unpublished day is never served —
 * the rules are in lib/days.ts.
 */
export async function servedQuestions(quizDate: string): Promise<ServedQuestion[]> {
  const [live, questions] = await Promise.all([
    isLive(quizDate),
    prisma.question.findMany({
      where: { quizDate },
      include: { theme: true },
      orderBy: { slot: "asc" },
    }),
  ]);
  return live ? questions : [];
}

/**
 * What the member's device is allowed to see. `correctIndex` is deliberately
 * absent — the answer only ever comes back in the response to her own submission.
 */
export function memberQuestion(q: ServedQuestion) {
  return {
    id: q.id,
    slot: q.slot,
    isBonus: q.isBonus,
    theme: { key: q.theme.key, label: q.theme.label },
    displayTag: q.displayTag,
    q: q.prompt,
    opts: q.options,
  };
}

/** The reveal payload (Q4/Q5), returned only after she has answered. */
export function revealPayload(q: ServedQuestion, defaultGoDeeperUrl: string) {
  const deepDive = q.deepDiveText.trim();
  return {
    whyThisMatters: q.whyThisMatters,
    chairLabel: q.chairLabel,
    chairText: q.chairText,
    deepDive: deepDive
      ? { text: deepDive, sourceLabel: q.sourceLabel, sourceUrl: q.sourceUrl }
      : null,
    goDeeperUrl: q.goDeeperUrl || defaultGoDeeperUrl || "",
  };
}

/**
 * The most recent earlier day that was live.
 *
 * Streaks are measured against this rather than literal yesterday, so a day
 * that never went live — empty, half filled, or simply not published — does
 * not break every member's streak through no fault of their own.
 */
export async function previousScheduledDate(
  tx: Prisma.TransactionClient,
  quizDate: string,
): Promise<string | null> {
  const previous = await tx.quizDay.findFirst({
    where: { quizDate: { lt: quizDate }, publishedAt: { not: null } },
    orderBy: { quizDate: "desc" },
    select: { quizDate: true },
  });
  return previous?.quizDate ?? null;
}
