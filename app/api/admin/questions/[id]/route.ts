import { requireSession } from "@/lib/auth";
import { TX_OPTIONS, dayInfo, isLive, publishDay } from "@/lib/days";
import { ApiError, conflict, json, notFound, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { questionPatchSchema } from "@/lib/schemas";
import { questionDetail } from "@/lib/serialize";

export const OPTIONS = preflight;

export const GET = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;

  const [question, answerCount] = await Promise.all([
    prisma.question.findUnique({ where: { id }, include: { theme: true } }),
    prisma.answer.count({ where: { questionId: id } }),
  ]);
  if (!question) throw notFound("That question no longer exists");

  const day = await dayInfo(question.quizDate);
  return json(req, { question: questionDetail(question, day.live, answerCount), day });
});

export const PATCH = route(async (req, ctx) => {
  const session = await requireSession(req);
  const { id } = await ctx.params;

  const [existing, answerCount] = await Promise.all([
    prisma.question.findUnique({ where: { id } }),
    prisma.answer.count({ where: { questionId: id } }),
  ]);
  if (!existing) throw notFound("That question no longer exists");

  const { publishDay: publish, ...patch } = questionPatchSchema.parse(await readJson(req));
  const merged = { ...existing, ...patch };

  const moving =
    merged.quizDate !== existing.quizDate ||
    merged.slot !== existing.slot ||
    merged.isBonus !== existing.isBonus;

  const [fromLive, toLive] = await Promise.all([
    isLive(existing.quizDate),
    merged.quizDate === existing.quizDate ? Promise.resolve(false) : isLive(merged.quizDate),
  ]);

  // A live day keeps its questions where they are…
  if (moving && fromLive) {
    throw new ApiError(
      `${existing.quizDate} is live, so this question can't be moved. Unpublish the day from the Schedule first.`,
      409,
      { fieldErrors: { quizDate: "Locked while this day is live" } },
    );
  }
  // …and can only gain a bonus, never another core question.
  if (toLive && !merged.isBonus) {
    throw conflict(`${merged.quizDate} is live, so only a bonus question can be moved onto it.`);
  }

  // What members answered cannot change underneath them.
  if (answerCount > 0) {
    const optionsChanged =
      patch.options !== undefined &&
      (patch.options.length !== existing.options.length ||
        patch.options.some((option, i) => option !== existing.options[i]));
    const answerChanged =
      patch.correctIndex !== undefined && patch.correctIndex !== existing.correctIndex;
    if (optionsChanged || answerChanged) {
      throw new ApiError(
        "Members have already answered this question, so its options and correct answer are locked.",
        409,
        { fieldErrors: { options: "Locked — members have already answered this question" } },
      );
    }
  }

  if (merged.correctIndex >= merged.options.length) {
    throw new ApiError("The correct answer must be one of the options", 422, {
      fieldErrors: { correctIndex: "Pick one of the options above" },
    });
  }
  if (merged.isBonus ? merged.slot !== 4 : merged.slot > 3) {
    throw new ApiError("Bonus questions use slot 4; the daily three use slots 1 to 3", 422, {
      fieldErrors: { slot: "Slot does not match the bonus setting" },
    });
  }

  // Moving a question onto a date/slot that is already taken.
  if (moving) {
    const clash = await prisma.question.findUnique({
      where: { quizDate_slot: { quizDate: merged.quizDate, slot: merged.slot } },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      throw conflict(`${merged.quizDate} already has a question in slot ${merged.slot}`);
    }
  }

  const question = await prisma.$transaction(async (tx) => {
    const updated = await tx.question.update({
      where: { id },
      data: { ...patch, updatedById: session.sub },
      include: { theme: true },
    });
    if (publish) await publishDay(tx, updated.quizDate, session.sub);
    return updated;
  }, TX_OPTIONS);

  const day = await dayInfo(question.quizDate);
  return json(req, { question: questionDetail(question, day.live, answerCount), day });
});

export const DELETE = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;

  const [question, answers] = await Promise.all([
    prisma.question.findUnique({ where: { id }, select: { quizDate: true } }),
    prisma.answer.count({ where: { questionId: id } }),
  ]);
  if (!question) throw notFound("That question no longer exists");

  if (await isLive(question.quizDate)) {
    throw conflict(
      `${question.quizDate} is live. Unpublish the day from the Schedule before deleting its questions.`,
    );
  }
  // Unreachable in practice — a day with answers can't be unpublished — but
  // deleting would take members' history with it, so it is refused outright.
  if (answers > 0) {
    throw conflict("Members have already answered this question, so it can't be deleted.");
  }

  await prisma.question.delete({ where: { id } });
  return json(req, { deleted: true });
});
