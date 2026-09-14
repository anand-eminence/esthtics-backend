import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { isValidDate } from "@/lib/date";
import { TX_OPTIONS, dayInfo, publishDay, unpublishDay } from "@/lib/days";
import { ApiError, json, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export const OPTIONS = preflight;

async function dateFrom(ctx: { params: Promise<Record<string, string>> }) {
  const { date } = await ctx.params;
  if (!isValidDate(date)) throw new ApiError("Use a date in the format YYYY-MM-DD", 400);
  return date;
}

/** One quiz day: its state, what it still needs, and whether members have
 *  played it. Read by the question form and the schedule. */
export const GET = route(async (req, ctx) => {
  await requireSession(req);
  const date = await dateFrom(ctx);
  return json(req, { day: await dayInfo(date) });
});

const liveSchema = z.object({ live: z.boolean() });

/** Publish ({ live: true }) or unpublish ({ live: false }) a day. */
export const PATCH = route(async (req, ctx) => {
  const session = await requireSession(req);
  const date = await dateFrom(ctx);
  const { live } = liveSchema.parse(await readJson(req));

  await prisma.$transaction(async (tx) => {
    if (live) await publishDay(tx, date, session.sub);
    else await unpublishDay(tx, date);
  }, TX_OPTIONS);

  return json(req, { day: await dayInfo(date) });
});
