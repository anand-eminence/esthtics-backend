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

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export const questionStatus = z.enum(["DRAFT", "READY", "PUBLISHED", "ARCHIVED"]);

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
  sourceUrl: optionalUrl,
  goDeeperUrl: optionalUrl,
  internalNotes: z.string().trim().max(2000).optional().default(""),
  status: questionStatus.optional().default("DRAFT"),
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
  questionsPerDay: z.coerce.number().int().min(1).max(10).optional(),
  bonusEnabled: z.boolean().optional(),
  joinUrl: patchUrl,
  defaultGoDeeperUrl: patchUrl,
  referralUrl: patchUrl,
  quizEmbedUrl: patchUrl,
});

// There is only one role, so an invite cannot pick one.
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  name: z.string().trim().min(1, "Enter a name").max(120),
});

export const questionListQuery = z.object({
  search: z.string().trim().optional(),
  date: z.string().trim().optional(), // YYYY-MM-DD (one day) or YYYY-MM (a month)
  themeId: z.string().trim().optional(),
  status: questionStatus.optional(),
  slot: z.coerce.number().int().min(1).max(4).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

export function parseQuery<T extends z.ZodTypeAny>(schema: T, req: Request): z.infer<T> {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries());
  const cleaned = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== ""));
  return schema.parse(cleaned);
}
