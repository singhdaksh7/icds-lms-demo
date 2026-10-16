-- Admin-managed Razorpay settings (single row). Secrets stored encrypted.
CREATE TABLE `razorpay_settings` (
    `id` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `keyId` VARCHAR(100) NOT NULL,
    `keySecretEnc` TEXT NOT NULL,
    `webhookSecretEnc` TEXT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
