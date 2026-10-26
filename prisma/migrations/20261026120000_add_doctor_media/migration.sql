-- CreateTable
CREATE TABLE `doctor_media` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `mediaMode` VARCHAR(10) NOT NULL DEFAULT 'PHOTO',
    `photoUrl` VARCHAR(500) NULL,
    `videoType` VARCHAR(10) NULL,
    `videoUrl` VARCHAR(500) NULL,
    `videoObjectKey` VARCHAR(255) NULL,
    `posterUrl` VARCHAR(500) NULL,
    `caption` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

