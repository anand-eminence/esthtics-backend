import type { Prisma } from "@prisma/client";
import { ApiError, conflict } from "./http";
import { prisma } from "./prisma";
import { today } from "./settings";

/**
 * PUBLISHING BELONGS TO THE DAY
 *
 * A question is content; its date decides whether members see it. A day goes
 * live when an admin publishes it, and it can only be published once all three
 * core slots are saved. The bonus (slot 4) is optional and never blocks
 * publishing — a live day shows it if it has one.
 *
 *  1. Members see a day only while it is live. Anything else is "No quiz today".
 *  2. Only live days count towards streaks (previousScheduledDate in lib/quiz).
 *  3. A live day's questions cannot be moved or deleted. Their wording can
 *     still be fixed, and a bonus can still be added.
 *  4. Once a member has answered a question, its options and correct answer are
 *     locked, so a recorded answer can never flip between right and wrong.
 *  5. A day can be unpublished only until the first member answers on it.
 *  6. A day that has already passed cannot be published or unpublished.
 */

export const CORE_SLOTS = [1, 2, 3];

/**
 * Saving and publishing in one transaction is several statements against a
 * database a few hundred milliseconds away. Prisma's default 5s limit for an
 * interactive transaction does not survive a cold start.
 */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export type DayState = "empty" | "in_progress" | "ready" | "live";

type Db = Prisma.TransactionClient;

export function missingCoreSlots(filled: Iterable<number>): number[] {
  const have = new Set(filled);
  return CORE_SLOTS.filter((slot) => !have.has(slot));
}

export function dayState(coreFilled: number, live: boolean): DayState {
  if (live) return "live";
  if (coreFilled === 0) return "empty";
  return coreFilled >= CORE_SLOTS.length ? "ready" : "in_progress";
}

/** "slot 2", "slot 2 and slot 3", "slot 1, slot 2 and slot 3" */
function describeSlots(slots: number[]) {
  const names = slots.map((slot) => `slot ${slot}`);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function isLive(quizDate: string, db: Db = prisma): Promise<boolean> {
  const day = await db.quizDay.findUnique({
    where: { quizDate },
    select: { publishedAt: true },
  });
  return Boolean(day?.publishedAt);
}

/** Which of these dates are live, in one query. */
export async function liveDates(dates: string[], db: Db = prisma): Promise<Set<string>> {
  const rows = await db.quizDay.findMany({
    where: { quizDate: { in: dates }, publishedAt: { not: null } },
    select: { quizDate: true },
  });
  return new Set(rows.map((row) => row.quizDate));
}

/** Everything the panel needs to know about one date. */
export async function dayInfo(quizDate: string, db: Db = prisma) {
  const [day, questions, answerCount, current] = await Promise.all([
    db.quizDay.findUnique({ where: { quizDate } }),
    db.question.findMany({
      where: { quizDate },
      select: { id: true, slot: true, isBonus: true },
      orderBy: { slot: "asc" },
    }),
    db.answer.count({ where: { quizDate } }),
    today(),
  ]);

  const core = questions.filter((q) => !q.isBonus);
  const live = Boolean(day?.publishedAt);

  return {
    quizDate,
    state: dayState(core.length, live),
    live,
    publishedAt: day?.publishedAt ?? null,
    isPast: quizDate < current,
    coreSlots: core.map((q) => ({ slot: q.slot, questionId: q.id })),
    missingSlots: missingCoreSlots(core.map((q) => q.slot)),
    bonusQuestionId: questions.find((q) => q.isBonus)?.id ?? null,
    answerCount,
  };
}

async function refusePast(quizDate: string, action: string) {
  if (quizDate < (await today())) {
    throw conflict(`${quizDate} has already passed, so it can't be ${action}.`);
  }
}

export async function publishDay(db: Db, quizDate: string, adminId: string) {
  await refusePast(quizDate, "published");

  const core = await db.question.findMany({
    where: { quizDate, isBonus: false },
    select: { slot: true },
  });
  const missing = missingCoreSlots(core.map((q) => q.slot));
  if (missing.length > 0) {
    throw new ApiError(`Add ${describeSlots(missing)} for ${quizDate} before publishing it.`, 422);
  }

  const now = new Date();
  return db.quizDay.upsert({
    where: { quizDate },
    create: { quizDate, publishedAt: now, publishedById: adminId },
    update: { publishedAt: now, publishedById: adminId },
  });
}

export async function unpublishDay(db: Db, quizDate: string) {
  await refusePast(quizDate, "unpublished");

  const answers = await db.answer.count({ where: { quizDate } });
  if (answers > 0) {
    throw conflict(`Members have already played ${quizDate}, so it has to stay live.`);
  }

  await db.quizDay.updateMany({
    where: { quizDate },
    data: { publishedAt: null, publishedById: null },
  });
}
