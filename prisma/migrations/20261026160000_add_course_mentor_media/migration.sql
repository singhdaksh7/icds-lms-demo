-- CreateTable
CREATE TABLE `course_mentor_media` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `mediaMode` VARCHAR(10) NOT NULL DEFAULT 'DEFAULT',
    `photoUrl` VARCHAR(500) NULL,
    `videoType` VARCHAR(10) NULL,
    `videoUrl` VARCHAR(500) NULL,
    `videoObjectKey` VARCHAR(255) NULL,
    `posterUrl` VARCHAR(500) NULL,
    `caption` VARCHAR(200) NULL,
    `autoplayMuted` BOOLEAN NOT NULL DEFAULT true,
    `loopVideo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `course_mentor_media_courseId_key`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `course_mentor_media` ADD CONSTRAINT `course_mentor_media_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

