import { requireSession } from "@/lib/auth";
import { ApiError, json, preflight, readJson, route } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/schemas";
import { getSettings, rememberSettings } from "@/lib/settings";

export const OPTIONS = preflight;

/** A10 · Settings. */
export const GET = route(async (req) => {
  await requireSession(req);
  const settings = await getSettings();
  return json(req, { settings });
});

export const PATCH = route(async (req) => {
  await requireSession(req);
  const patch = settingsSchema.parse(await readJson(req));

  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: patch.timezone });
    } catch {
      throw new ApiError("That is not a recognised timezone", 422, {
        fieldErrors: { timezone: "Use an IANA name such as America/New_York" },
      });
    }
  }

  await getSettings(); // make sure the row exists before updating
  const settings = await prisma.setting.update({
    where: { id: "singleton" },
    data: patch,
  });
  rememberSettings(settings);
  return json(req, { settings });
});
