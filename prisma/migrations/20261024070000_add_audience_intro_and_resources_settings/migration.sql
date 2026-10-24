-- AlterTable
ALTER TABLE `course_landing_contents` ADD COLUMN `audienceIntro` TEXT NULL,
    ADD COLUMN `resourcesEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `resourcesEyebrow` VARCHAR(100) NULL,
    ADD COLUMN `resourcesHeading` VARCHAR(255) NULL,
    ADD COLUMN `resourcesIntro` TEXT NULL;
