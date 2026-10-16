-- Per-course GST override (NULL = site default, 0 = exempt).
ALTER TABLE `courses` ADD COLUMN `gstRate` DECIMAL(5, 2) NULL;

-- Tax breakdown stored on each order; `amount` remains the total charged.
ALTER TABLE `orders`
    ADD COLUMN `subtotalAmount` DECIMAL(10, 2) NULL,
    ADD COLUMN `taxAmount` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxInclusive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `paidAt` DATETIME(3) NULL;
