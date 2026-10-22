-- AlterTable: course_landing_contents
ALTER TABLE `course_landing_contents`
    ADD COLUMN `heroEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `heroPrimaryCtaLabel` VARCHAR(100) NULL,
    ADD COLUMN `curriculumShowSessionCount` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `curriculumShowTotalDuration` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `curriculumShowResourceCount` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `finalCtaLine1` VARCHAR(255) NULL,
    ADD COLUMN `finalCtaLine2` VARCHAR(255) NULL,
    ADD COLUMN `finalCtaLine3` VARCHAR(255) NULL,
    ADD COLUMN `highlightsEyebrow` VARCHAR(100) NULL DEFAULT 'Course Highlights',
    ADD COLUMN `purchaseCardEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `purchaseCardEyebrow` VARCHAR(100) NULL,
    ADD COLUMN `purchaseCardHeading` VARCHAR(255) NULL,
    ADD COLUMN `purchaseCardDescription` TEXT NULL,
    ADD COLUMN `purchaseCardButtonLabel` VARCHAR(100) NULL,
    ADD COLUMN `comparisonEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `comparisonEyebrow` VARCHAR(100) NULL,
    ADD COLUMN `comparisonHeading` VARCHAR(255) NULL,
    ADD COLUMN `comparisonDescription` TEXT NULL,
    ADD COLUMN `accessSectionEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `accessEyebrow` VARCHAR(100) NULL,
    ADD COLUMN `accessHeading` VARCHAR(255) NULL,
    ADD COLUMN `accessDescription` TEXT NULL,
    ADD COLUMN `accessMediaType` VARCHAR(20) NULL DEFAULT 'NONE',
    ADD COLUMN `accessMediaUrl` VARCHAR(500) NULL,
    ADD COLUMN `accessStepsEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `socialProofEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `socialProofMode` VARCHAR(20) NULL DEFAULT 'AUTO',
    ADD COLUMN `socialProofValue` VARCHAR(100) NULL,
    ADD COLUMN `socialProofLabel` VARCHAR(255) NULL;

-- CreateTable: course_access_plans
CREATE TABLE `course_access_plans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `durationDays` INTEGER NULL,
    `price` DECIMAL(10, 2) NULL,
    `salePrice` DECIMAL(10, 2) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_access_plans_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_stats
CREATE TABLE `course_stats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `icon` VARCHAR(50) NULL,
    `value` VARCHAR(100) NULL,
    `label` VARCHAR(100) NOT NULL,
    `statType` VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_stats_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_comparison_columns
CREATE TABLE `course_comparison_columns` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `subtitle` VARCHAR(200) NULL,
    `badgeText` VARCHAR(100) NULL,
    `isRecommended` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_comparison_columns_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_comparison_items
CREATE TABLE `course_comparison_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `columnId` INTEGER NOT NULL,
    `text` VARCHAR(300) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_comparison_items_columnId_sortOrder_idx`(`columnId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_access_steps
CREATE TABLE `course_access_steps` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(50) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_access_steps_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_landing_sections
CREATE TABLE `course_landing_sections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `sectionKey` VARCHAR(50) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `course_landing_sections_courseId_sectionKey_key`(`courseId`, `sectionKey`),
    INDEX `course_landing_sections_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `course_access_plans` ADD CONSTRAINT `course_access_plans_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_stats` ADD CONSTRAINT `course_stats_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_comparison_columns` ADD CONSTRAINT `course_comparison_columns_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_comparison_items` ADD CONSTRAINT `course_comparison_items_columnId_fkey` FOREIGN KEY (`columnId`) REFERENCES `course_comparison_columns`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_access_steps` ADD CONSTRAINT `course_access_steps_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_landing_sections` ADD CONSTRAINT `course_landing_sections_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
