import type { Prisma, Question, QuestionStatus, Theme } from "@prisma/client";
import { ApiError } from "./http";
import { prisma } from "./prisma";

/** A3: "Only rows set to Ready or Published are served to members." */
export const SERVED_STATUSES: QuestionStatus[] = ["READY", "PUBLISHED"];

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

export function servedQuestions(quizDate: string) {
  return prisma.question.findMany({
    where: { quizDate, status: { in: SERVED_STATUSES } },
    include: { theme: true },
    orderBy: { slot: "asc" },
  });
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
 * The most recent earlier date that actually had questions scheduled.
 *
 * Streaks are measured against this rather than literal yesterday, so a day the
 * admin left empty does not break every member's streak through no fault of
 * their own.
 */
export async function previousScheduledDate(
  tx: Prisma.TransactionClient,
  quizDate: string,
): Promise<string | null> {
  const previous = await tx.question.findFirst({
    where: { quizDate: { lt: quizDate }, isBonus: false, status: { in: SERVED_STATUSES } },
    orderBy: { quizDate: "desc" },
    select: { quizDate: true },
  });
  return previous?.quizDate ?? null;
}
