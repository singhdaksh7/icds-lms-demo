-- AlterTable
-- Splits "where playback resumes" from "how much has genuinely been
-- watched", which were previously conflated in a single `watchedSeconds`
-- column (it was actually being written with the raw playback position on
-- every save — see old src/services/progress.service.js — so seeking to the
-- end of a video before ever finishing it could satisfy the 90% completion
-- threshold). New column `lastPositionSeconds` takes over the resume role;
-- `watchedSeconds` is redefined to mean legitimate accumulated watched time
-- and is now only ever incremented by small, playback-verified deltas from
-- the client (see progress.service.js).
ALTER TABLE `lesson_progress`
    ADD COLUMN `lastPositionSeconds` INTEGER NOT NULL DEFAULT 0;

-- Backfill: the old `watchedSeconds` value was actually a playback
-- position, so it becomes the initial `lastPositionSeconds` (preserves
-- resume behavior for existing students — nobody's "continue where you left
-- off" position is lost).
UPDATE `lesson_progress` SET `lastPositionSeconds` = `watchedSeconds`;

-- Compatibility decision for the redefined `watchedSeconds` (documented per
-- deployment instructions — do not assume old values are trustworthy as
-- real accumulated watch time):
--   * Rows already marked `completed = true` keep their completed status
--     (never regress an already-earned completion) and get
--     `watchedSeconds = durationSeconds`, so their progress bar still shows
--     100% instead of suddenly dropping.
--   * Rows NOT completed have `watchedSeconds` reset to 0, since the old
--     column never actually measured accumulated watch time and cannot be
--     trusted as a lower bound. These students will see their in-progress
--     percentage restart at 0% on next view, but resume-to-position still
--     works via `lastPositionSeconds`, and no lesson is falsely marked
--     complete or incomplete by this reset.
UPDATE `lesson_progress` SET `watchedSeconds` = `durationSeconds` WHERE `completed` = true;
UPDATE `lesson_progress` SET `watchedSeconds` = 0 WHERE `completed` = false;
