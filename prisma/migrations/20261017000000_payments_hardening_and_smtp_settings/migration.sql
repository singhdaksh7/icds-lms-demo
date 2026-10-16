-- One Razorpay payment id can settle at most one local order (NULLs allowed).
CREATE UNIQUE INDEX `orders_providerPaymentId_key` ON `orders`(`providerPaymentId`);

-- Admin-managed SMTP settings (single row). Password stored encrypted.
CREATE TABLE `smtp_settings` (
    `id` INTEGER NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 587,
    `secure` BOOLEAN NOT NULL DEFAULT false,
    `username` VARCHAR(255) NULL,
    `passwordEnc` TEXT NULL,
    `fromEmail` VARCHAR(255) NOT NULL,
    `fromName` VARCHAR(255) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
