-- CreateTable
-- Replaces express-mysql-session's own "sessions" table (created ad hoc via
-- createDatabaseTable: true, with an incompatible schema: session_id/
-- expires/data only) with a Prisma-managed one. Session data is ephemeral
-- by design, so dropping any pre-existing copy of this table is safe -- it
-- only forces already-logged-in users to log in again.
DROP TABLE IF EXISTS `sessions`;

CREATE TABLE `sessions` (
    `id` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `data` TEXT NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `sessions_userId_idx`(`userId`),
    INDEX `sessions_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
