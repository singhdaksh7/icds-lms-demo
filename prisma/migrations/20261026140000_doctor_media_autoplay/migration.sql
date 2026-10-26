-- AlterTable
ALTER TABLE `doctor_media` ADD COLUMN `autoplayMuted` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `loopVideo` BOOLEAN NOT NULL DEFAULT false;

