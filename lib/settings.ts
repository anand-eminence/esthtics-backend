import type { Setting } from "@prisma/client";
import { prisma } from "./prisma";
import { fallbackTimezone, todayInTz } from "./date";

const TTL_MS = 30_000;

let cache: { at: number; value: Setting } | null = null;

export function rememberSettings(value: Setting) {
  cache = { at: Date.now(), value };
}

export async function getSettings(): Promise<Setting> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const value =
    (await prisma.setting.findUnique({ where: { id: "singleton" } })) ??
    (await prisma.setting.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", timezone: fallbackTimezone() },
      update: {},
    }));

  rememberSettings(value);
  return value;
}

export async function getTimezone(): Promise<string> {
  const settings = await getSettings();
  return settings.timezone || fallbackTimezone();
}

/** Today's date in the timezone the admin configured, not the server's. */
export async function today(): Promise<string> {
  return todayInTz(await getTimezone());
}
