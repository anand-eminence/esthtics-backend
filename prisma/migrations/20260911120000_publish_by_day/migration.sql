-- Publishing moves from each question to the day it belongs to. A day is live
-- once its three core questions are saved and it is published — see lib/days.ts.

-- CreateTable
CREATE TABLE "QuizDay" (
    "quizDate" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizDay_pkey" PRIMARY KEY ("quizDate")
);

-- CreateIndex
CREATE INDEX "QuizDay_publishedAt_idx" ON "QuizDay"("publishedAt");

-- AddForeignKey
ALTER TABLE "QuizDay" ADD CONSTRAINT "QuizDay_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Carry existing days across before the per-question status is dropped. A day
-- becomes live if members were already being served it in full — all three
-- core slots Ready or Published — or if anyone has answered on it, so recorded
-- history stays attached to a live day. Every other date starts unpublished.
INSERT INTO "QuizDay" ("quizDate", "publishedAt", "updatedAt")
SELECT served."quizDate", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
    SELECT "quizDate"
    FROM "Question"
    WHERE "isBonus" = false
      AND "slot" IN (1, 2, 3)
      AND "status" IN ('READY', 'PUBLISHED')
    GROUP BY "quizDate"
    HAVING COUNT(DISTINCT "slot") = 3
    UNION
    SELECT DISTINCT "quizDate" FROM "Answer"
) AS served;

-- DropIndex
DROP INDEX "Question_quizDate_status_idx";

-- DropIndex
DROP INDEX "Question_status_idx";

-- AlterTable
ALTER TABLE "Question" DROP COLUMN "status";

-- AlterTable: every day has exactly three core questions, so it is no longer a setting
ALTER TABLE "Setting" DROP COLUMN "questionsPerDay";

-- DropEnum
DROP TYPE "QuestionStatus";
