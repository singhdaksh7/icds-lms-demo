-- AlterTable
ALTER TABLE `contact_messages` ADD COLUMN `courseId` INTEGER NULL,
    ADD COLUMN `phone` VARCHAR(40) NULL,
    ADD COLUMN `reason` VARCHAR(100) NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    MODIFY `status` ENUM('NEW', 'READ', 'IN_PROGRESS', 'RESOLVED', 'SPAM') NOT NULL DEFAULT 'NEW';

-- CreateIndex
CREATE INDEX `contact_messages_status_createdAt_idx` ON `contact_messages`(`status`, `createdAt`);

-- CreateIndex
CREATE INDEX `contact_messages_courseId_idx` ON `contact_messages`(`courseId`);

-- AddForeignKey
ALTER TABLE `contact_messages` ADD CONSTRAINT `contact_messages_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

