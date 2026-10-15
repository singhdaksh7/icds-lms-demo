-- AlterTable
-- Server-side clock used to bound credited watch time by real elapsed
-- time. Nullable: existing rows start their clock on the next save.
ALTER TABLE `lesson_progress`
    ADD COLUMN `lastCreditAt` DATETIME(3) NULL;
