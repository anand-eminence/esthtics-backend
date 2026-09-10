import { requireSession } from "@/lib/auth";
import { ApiError, conflict, json, notFound, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { questionPatchSchema } from "@/lib/schemas";
import { questionDetail } from "@/lib/serialize";

export const OPTIONS = preflight;

export const GET = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;

  const question = await prisma.question.findUnique({ where: { id }, include: { theme: true } });
  if (!question) throw notFound("That question no longer exists");

  return json(req, { question: questionDetail(question) });
});

export const PATCH = route(async (req, ctx) => {
  const session = await requireSession(req);
  const { id } = await ctx.params;

  const existing = await prisma.question.findUnique({ where: { id } });
  if (!existing) throw notFound("That question no longer exists");

  const patch = questionPatchSchema.parse(await readJson(req));

  const merged = { ...existing, ...patch };
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
  if (
    (patch.quizDate && patch.quizDate !== existing.quizDate) ||
    (patch.slot && patch.slot !== existing.slot)
  ) {
    const clash = await prisma.question.findUnique({
      where: { quizDate_slot: { quizDate: merged.quizDate, slot: merged.slot } },
      select: { id: true },
    });
    if (clash && clash.id !== id) {
      throw conflict(`${merged.quizDate} already has a question in slot ${merged.slot}`);
    }
  }

  const question = await prisma.question.update({
    where: { id },
    data: { ...patch, updatedById: session.sub },
    include: { theme: true },
  });

  return json(req, { question: questionDetail(question) });
});

export const DELETE = route(async (req, ctx) => {
  await requireSession(req);
  const { id } = await ctx.params;

  const answers = await prisma.answer.count({ where: { questionId: id } });
  if (answers > 0) {
    // Members have already played it; removing the row would break their history.
    const question = await prisma.question.update({
      where: { id },
      data: { status: "ARCHIVED" },
      include: { theme: true },
    });
    return json(req, {
      archived: true,
      message: `${answers} members have answered this, so it was archived instead of deleted.`,
      question: questionDetail(question),
    });
  }

  await prisma.question.delete({ where: { id } });
  return json(req, { deleted: true });
});
