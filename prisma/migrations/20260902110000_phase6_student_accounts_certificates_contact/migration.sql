-- Phase 6: certificate identifiers and contact-inbox workflow.
-- Existing records are safely backfilled before columns become required.
ALTER TABLE `certificates` ADD COLUMN `certificateNumber` VARCHAR(100) NULL;
UPDATE `certificates`
SET `certificateNumber` = CONCAT('ICDS-CERT-LEGACY-', LPAD(`id`, 6, '0'))
WHERE `certificateNumber` IS NULL;
ALTER TABLE `certificates` MODIFY `certificateNumber` VARCHAR(100) NOT NULL;
CREATE UNIQUE INDEX `certificates_certificateNumber_key` ON `certificates`(`certificateNumber`);

ALTER TABLE `contact_messages` ADD COLUMN `subject` VARCHAR(191) NULL,
    ADD COLUMN `status` ENUM('NEW', 'READ', 'RESOLVED') NOT NULL DEFAULT 'NEW';
UPDATE `contact_messages` SET `subject` = 'No subject' WHERE `subject` IS NULL;
ALTER TABLE `contact_messages` MODIFY `subject` VARCHAR(191) NOT NULL;
