import { z } from "zod";
import { DATE_RE, isValidDate } from "./date";

const quizDate = z
  .string()
  .regex(DATE_RE, "Use the format YYYY-MM-DD")
  .refine(isValidDate, "That is not a real date");

const urlish = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (v) => v === "" || /^(https?:\/\/|\/)/.test(v),
    "Enter a full URL or a path starting with /",
  );

/** For create payloads: an absent URL is stored as "". */
const optionalUrl = urlish.optional().default("");

/** For patch payloads: an absent URL must stay absent, so it is left alone
 *  rather than being blanked out. */
const patchUrl = urlish.optional();

/**
 * A link a member opens from inside the quiz — a question's source and its
 * "go deeper" link. Stricter than urlish on purpose. It must be absolute: the
 * quiz is framed on its own host, so a bare /path would resolve there rather
 * than on the community site. And it must have a real hostname, so
 * "https://deeper" or a sentence pasted into the box is refused at save time
 * instead of becoming a dead link in front of a member.
 */
export function linkProblem(value: string): string | null {
  if (/\s/.test(value)) return "Links cannot contain spaces";
  if (!/^https?:\/\//i.test(value)) return "Start the link with https://";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Enter a valid link, e.g. https://example.com";
  }
  if (!/^(localhost|([a-z0-9-]+\.)+[a-z0-9-]{2,})$/i.test(url.hostname)) {
    return "Enter a valid link, e.g. https://example.com";
  }
  return null;
}

const memberLink = z
  .string()
  .trim()
  .max(2048)
  .superRefine((value, ctx) => {
    if (value === "") return;
    const problem = linkProblem(value);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  })
  .optional()
  .default("");

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

const questionBase = z.object({
  quizDate,
  slot: z.coerce.number().int().min(1).max(4),
  isBonus: z.boolean().optional().default(false),
  themeId: z.string().min(1, "Pick a theme"),
  prompt: z.string().trim().min(1, "Write the question").max(500),
  options: z
    .array(z.string().trim().min(1, "Options cannot be blank").max(200))
    .min(2, "At least two options")
    .max(6, "At most six options"),
  correctIndex: z.coerce.number().int().min(0),
  displayTag: z.string().trim().max(60).optional().default(""),
  whyThisMatters: z.string().trim().max(2000).optional().default(""),
  chairLabel: z.string().trim().max(80).optional().default(""),
  chairText: z.string().trim().max(2000).optional().default(""),
  deepDiveText: z.string().trim().max(4000).optional().default(""),
  sourceLabel: z.string().trim().max(200).optional().default(""),
  sourceUrl: memberLink,
  goDeeperUrl: memberLink,
  internalNotes: z.string().trim().max(2000).optional().default(""),
  // Not a column. Asks the API to publish the question's day in the same
  // transaction as the save — the "Save & publish day" button.
  publishDay: z.boolean().optional().default(false),
});

export const questionSchema = questionBase
  .refine((v) => v.correctIndex < v.options.length, {
    message: "The correct answer must be one of the options",
    path: ["correctIndex"],
  })
  .refine((v) => (v.isBonus ? v.slot === 4 : v.slot <= 3), {
    message: "Bonus questions use slot 4; the daily three use slots 1 to 3",
    path: ["slot"],
  });

// A PATCH may send any subset, so the cross-field rules above are re-checked
// against the merged record in the route handler instead.
export const questionPatchSchema = questionBase.partial();

export const featuredStatus = z.enum(["DRAFT", "READY", "LIVE"]);

export const featuredSchema = z.object({
  quizDate,
  title: z.string().trim().min(1, "Give it a title").max(160),
  bodyText: z.string().trim().max(2000).optional().default(""),
  buttonLabel: z.string().trim().max(60).optional().default(""),
  linkUrl: optionalUrl,
  imageUrl: optionalUrl,
  shownAfter: z.string().trim().max(40).optional().default("final_question"),
  status: featuredStatus.optional().default("DRAFT"),
});

export const featuredPatchSchema = featuredSchema.partial();

// Every field is optional: the Settings screen may save one card at a time,
// and an unsent field must keep its stored value.
export const settingsSchema = z.object({
  timezone: z.string().trim().min(1).max(64).optional(),
  bonusEnabled: z.boolean().optional(),
  joinUrl: patchUrl,
  defaultGoDeeperUrl: patchUrl,
  quizEmbedUrl: patchUrl,
});

export const questionListQuery = z.object({
  search: z.string().trim().optional(),
  date: z.string().trim().optional(), // YYYY-MM-DD (one day) or YYYY-MM (a month)
  themeId: z.string().trim().optional(),
  day: z.enum(["live", "not_live"]).optional(),
  slot: z.coerce.number().int().min(1).max(4).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const cleaned = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== ""));
  return schema.parse(cleaned);
}
