-- AlterTable
ALTER TABLE `course_testimonials` ADD COLUMN `reviewType` ENUM('TEXT', 'VIDEO', 'TEXT_VIDEO') NOT NULL DEFAULT 'TEXT',
    ADD COLUMN `videoUrl` VARCHAR(500) NULL,
    ADD COLUMN `videoObjectKey` VARCHAR(255) NULL,
    ADD COLUMN `videoThumbnailUrl` VARCHAR(500) NULL,
    ADD COLUMN `videoDurationSeconds` INTEGER NULL;
