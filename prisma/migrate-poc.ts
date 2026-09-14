/**
 * Copies the POC data (esti-backend / neondb) into the admin-panel schema.
 *
 *   npm run db:migrate-poc -- ../backups/neondb-poc-2026-09-02
 *
 * Reads the CSV export rather than connecting to the old database, so it can be
 * re-run after neondb is gone. Idempotent: original ids are preserved and every
 * write is an upsert, so running it twice changes nothing.
 *
 * Field mapping (POC -> here):
 *   track -> displayTag        aha   -> whyThisMatters
 *   lbl   -> chairLabel        chair -> chairText
 *   slug  -> internalNotes     DailyDrop -> FeaturedContent
 *   status "published" on a question -> a published QuizDay for its date
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Minimal RFC 4180 reader — the options column contains quoted JSON. */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const bool = (v: string) => v === "t" || v === "true" || v === "TRUE";
const nullable = (v: string) => (v === "" ? null : v);
const date = (v: string) => (v === "" ? new Date() : new Date(v));

async function main() {
  const dir = resolve(process.argv[2] || "../backups/neondb-poc-2026-09-02");
  console.log(`Reading ${dir}\n`);

  const themes = await prisma.theme.findMany();
  const themeByKey = new Map(themes.map((t) => [t.key, t.id]));
  if (!themeByKey.size) throw new Error("No themes found — run `npm run db:seed` first.");

  // ---------------------------------------------------------------- members
  const members = readCsv(join(dir, "Member.csv"));
  for (const m of members) {
    await prisma.member.upsert({
      where: { circleUid: m.circleUid },
      create: {
        id: m.id,
        circleUid: m.circleUid,
        email: m.email,
        name: m.name,
        currentStreak: Number(m.currentStreak) || 0,
        longestStreak: Number(m.longestStreak) || 0,
        lastPlayedDate: nullable(m.lastPlayedDate),
        createdAt: date(m.createdAt),
      },
      update: { email: m.email, name: m.name },
    });
  }
  console.log(`Members       ${members.length}`);

  // -------------------------------------------------------------- questions
  const questions = readCsv(join(dir, "Question.csv"));
  const questionById = new Map(questions.map((q) => [q.id, q]));

  for (const q of questions) {
    const themeId = themeByKey.get(q.theme);
    if (!themeId) {
      console.warn(`  ! skipped ${q.slug}: unknown theme "${q.theme}"`);
      continue;
    }

    const data = {
      quizDate: q.quizDate,
      slot: Number(q.slot),
      isBonus: bool(q.isBonus),
      themeId,
      prompt: q.prompt,
      options: JSON.parse(q.options || "[]") as string[],
      correctIndex: Number(q.correctIndex),
      displayTag: q.track || "",
      whyThisMatters: q.aha || "",
      chairLabel: q.lbl || "",
      chairText: q.chair || "",
      deepDiveText: q.deepdiveText || "",
      sourceLabel: q.sourceLabel || "",
      sourceUrl: q.sourceUrl || "",
      // The POC's slug has no home in the new schema; keep it as provenance.
      internalNotes: q.slug ? `Imported from the POC (slug: ${q.slug})` : "",
    };

    await prisma.question.upsert({ where: { id: q.id }, create: { id: q.id, ...data }, update: data });
  }
  console.log(`Questions     ${questions.length}`);

  // -------------------------------------------------------------- quiz days
  // Publishing is per day here. Every date the POC served goes in as a live
  // day, so the imported answers stay attached to a day members could play.
  const servedDates = Array.from(
    new Set(questions.filter((q) => q.status === "published").map((q) => q.quizDate)),
  );
  for (const quizDate of servedDates) {
    await prisma.quizDay.upsert({
      where: { quizDate },
      create: { quizDate, publishedAt: new Date() },
      update: {},
    });
  }
  console.log(`Quiz days     ${servedDates.length} published`);

  // ---------------------------------------------------------------- answers
  const answers = readCsv(join(dir, "Answer.csv"));
  for (const a of answers) {
    const q = questionById.get(a.questionId);
    if (!q) {
      console.warn(`  ! skipped answer ${a.id}: question not in the export`);
      continue;
    }
    const themeId = themeByKey.get(q.theme);
    if (!themeId) continue;

    await prisma.answer.upsert({
      where: { memberId_questionId: { memberId: a.memberId, questionId: a.questionId } },
      create: {
        id: a.id,
        memberId: a.memberId,
        questionId: a.questionId,
        themeId,
        quizDate: a.quizDate,
        slot: Number(q.slot),
        selectedIndex: Number(a.selectedIndex),
        correct: bool(a.correct),
        isBonus: bool(a.isBonus),
        streakAtPlay: 0, // not recorded by the POC
        createdAt: date(a.createdAt),
      },
      update: {},
    });
  }
  console.log(`Answers       ${answers.length}`);

  // ------------------------------------------------------- featured content
  try {
    const drops = readCsv(join(dir, "DailyDrop.csv"));
    for (const d of drops) {
      const data = {
        quizDate: d.quizDate,
        title: d.title,
        bodyText: d.message || "",
        buttonLabel: d.ctaLabel || "",
        linkUrl: d.ctaUrl || "",
        status: "LIVE" as const,
      };
      await prisma.featuredContent.upsert({
        where: { quizDate: d.quizDate },
        create: data,
        update: data,
      });
    }
    console.log(`Featured      ${drops.length}`);
  } catch {
    console.log("Featured      0 (no DailyDrop.csv)");
  }

  // --------------------------------------------- derive per-day progress
  // The POC had no DailyProgress table, so it is rebuilt from the answers.
  // Without it the admin screens cannot tell who finished a day.
  const stored = await prisma.answer.findMany({
    where: { quizDate: { in: [...new Set(answers.map((a) => a.quizDate))] } },
    include: { question: { select: { isBonus: true } } },
  });

  const required = new Map<string, number>();
  const hasBonus = new Set<string>();
  for (const q of questions) {
    if (q.status !== "published") continue;
    if (bool(q.isBonus)) hasBonus.add(q.quizDate);
    else required.set(q.quizDate, (required.get(q.quizDate) ?? 0) + 1);
  }

  const buckets = new Map<string, typeof stored>();
  for (const a of stored) {
    const key = `${a.memberId}|${a.quizDate}`;
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }

  for (const [key, rows] of buckets) {
    const [memberId, quizDate] = key.split("|");
    const daily = rows.filter((r) => !r.isBonus);
    const need = required.get(quizDate) ?? daily.length;
    const complete = need > 0 && daily.length >= need;

    await prisma.dailyProgress.upsert({
      where: { memberId_quizDate: { memberId, quizDate } },
      create: {
        memberId,
        quizDate,
        answeredCount: daily.length,
        correctCount: daily.filter((r) => r.correct).length,
        requiredCount: need,
        bonusOffered: hasBonus.has(quizDate),
        bonusPlayed: rows.some((r) => r.isBonus),
        completedAt: complete ? rows[rows.length - 1].createdAt : null,
      },
      update: {},
    });

    // Bring the member's own counters in line with what they actually played.
    const played = await prisma.dailyProgress.findMany({
      where: { memberId, completedAt: { not: null } },
      select: { quizDate: true },
      orderBy: { quizDate: "asc" },
    });
    if (played.length) {
      await prisma.member.update({
        where: { id: memberId },
        data: {
          daysPlayed: played.length,
          firstPlayedDate: played[0].quizDate,
          lastPlayedDate: played[played.length - 1].quizDate,
        },
      });
    }
  }
  console.log(`DailyProgress ${buckets.size} derived`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
