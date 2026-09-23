-- CreateTable
-- Generic admin-editable key/value content store for homepage sections
-- (Why ICDS, Learning Process, Instructors intro, Newsletter intro),
-- navigation section visibility, and brand/footer text overrides. New
-- table only, no existing data touched.
CREATE TABLE `site_settings` (
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
