-- AlterTable
-- Adds support for Hostinger-local (non-YouTube/Vimeo) lesson videos.
-- videoType defaults to 'EXTERNAL' so every existing lesson keeps working
-- unchanged. videoPath is a server-side-only relative path under
-- storage/videos/ used solely by the protected /media route.
ALTER TABLE `lessons`
    ADD COLUMN `videoType` ENUM('EXTERNAL', 'LOCAL') NOT NULL DEFAULT 'EXTERNAL',
    ADD COLUMN `videoPath` VARCHAR(500) NULL;
