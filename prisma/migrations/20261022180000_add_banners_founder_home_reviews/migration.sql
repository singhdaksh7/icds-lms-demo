-- AlterTable
ALTER TABLE `instructors` ADD COLUMN `founderIntro` TEXT NULL,
    ADD COLUMN `isFounder` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `qualificationsLine` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `course_testimonials` ADD COLUMN `featuredOnHome` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `homeSortOrder` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `home_banners` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(255) NULL,
    `subtitle` VARCHAR(500) NULL,
    `description` TEXT NULL,
    `imageUrl` VARCHAR(500) NOT NULL,
    `mobileImageUrl` VARCHAR(500) NULL,
    `ctaLabel` VARCHAR(100) NULL,
    `ctaUrl` VARCHAR(500) NULL,
    `secondaryCtaLabel` VARCHAR(100) NULL,
    `secondaryCtaUrl` VARCHAR(500) NULL,
    `overlayEnabled` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `startAt` DATETIME(3) NULL,
    `endAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `home_banners_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `founder_qualifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(300) NOT NULL,
    `subtitle` VARCHAR(500) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `founder_qualifications_isPublished_sortOrder_idx`(`isPublished`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `founder_timeline_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instructorId` INTEGER NOT NULL,
    `yearLabel` VARCHAR(100) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `founder_timeline_entries_instructorId_sortOrder_idx`(`instructorId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `founder_initiatives` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NOT NULL,
    `imageUrl` VARCHAR(500) NULL,
    `iconKey` VARCHAR(50) NULL,
    `ctaLabel` VARCHAR(100) NULL,
    `ctaUrl` VARCHAR(500) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `founder_initiatives_isPublished_sortOrder_idx`(`isPublished`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `founder_stats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `valueText` VARCHAR(50) NOT NULL,
    `label` VARCHAR(200) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `founder_stats_isPublished_sortOrder_idx`(`isPublished`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `founder_faqs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question` VARCHAR(500) NOT NULL,
    `answer` TEXT NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `founder_faqs_isPublished_sortOrder_idx`(`isPublished`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `founder_research_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instructorId` INTEGER NOT NULL,
    `title` VARCHAR(500) NOT NULL,
    `description` TEXT NULL,
    `kind` VARCHAR(50) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `founder_research_items_instructorId_kind_sortOrder_idx`(`instructorId`, `kind`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `course_testimonials_featuredOnHome_isPublished_isDemo_homeSo_idx` ON `course_testimonials`(`featuredOnHome`, `isPublished`, `isDemo`, `homeSortOrder`);

-- AddForeignKey
ALTER TABLE `founder_timeline_entries` ADD CONSTRAINT `founder_timeline_entries_instructorId_fkey` FOREIGN KEY (`instructorId`) REFERENCES `instructors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `founder_research_items` ADD CONSTRAINT `founder_research_items_instructorId_fkey` FOREIGN KEY (`instructorId`) REFERENCES `instructors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

