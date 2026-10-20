-- AlterTable
-- Additive only: adds Cloudflare R2 video support. Existing lessons keep their
-- current videoType (EXTERNAL / LOCAL) and videoPath untouched; no data is
-- rewritten. R2 lessons store just a server-generated object key.
ALTER TABLE `lessons`
    MODIFY COLUMN `videoType` ENUM('EXTERNAL', 'LOCAL', 'R2') NOT NULL DEFAULT 'EXTERNAL',
    ADD COLUMN `videoObjectKey` VARCHAR(500) NULL,
    ADD COLUMN `videoDurationSeconds` INTEGER NULL,
    ADD COLUMN `videoSizeBytes` BIGINT NULL,
    ADD COLUMN `videoMimeType` VARCHAR(100) NULL;
