-- AlterTable
ALTER TABLE `certificates` ADD COLUMN `adminNote` TEXT NULL,
    ADD COLUMN `issuedByUserId` INTEGER NULL,
    ADD COLUMN `revokedAt` DATETIME(3) NULL,
    ADD COLUMN `source` ENUM('COMPLETION', 'ADMIN_ISSUED') NOT NULL DEFAULT 'COMPLETION',
    ADD COLUMN `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX `certificates_issuedByUserId_idx` ON `certificates`(`issuedByUserId`);

-- AddForeignKey
ALTER TABLE `certificates` ADD CONSTRAINT `certificates_issuedByUserId_fkey` FOREIGN KEY (`issuedByUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
