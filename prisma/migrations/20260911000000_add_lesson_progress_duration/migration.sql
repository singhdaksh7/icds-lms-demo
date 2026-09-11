-- AlterTable
-- Adds the minimal field needed for resumable video playback: durationSeconds.
-- watchedSeconds (already present) doubles as the resume/last-position field,
-- so no new "position" column is added — see prisma/schema.prisma comment on
-- LessonProgress. Defaults to 0 so existing rows remain valid.
ALTER TABLE `lesson_progress`
    ADD COLUMN `durationSeconds` INTEGER NOT NULL DEFAULT 0;
