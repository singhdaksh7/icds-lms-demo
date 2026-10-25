-- AlterTable
ALTER TABLE `courses` ADD COLUMN `saleBadgeLabel` VARCHAR(40) NULL,
    ADD COLUMN `saleEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `saleEndsAt` DATETIME(3) NULL,
    ADD COLUMN `saleStartsAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `faqs` ADD COLUMN `category` VARCHAR(100) NULL;

-- CreateTable
CREATE TABLE `course_player_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `showSidebar` BOOLEAN NOT NULL DEFAULT true,
    `sidebarDefaultOpen` BOOLEAN NOT NULL DEFAULT true,
    `sidebarTitle` VARCHAR(100) NULL,
    `showCourseProgress` BOOLEAN NOT NULL DEFAULT true,
    `showModuleProgress` BOOLEAN NOT NULL DEFAULT true,
    `showLessonDurations` BOOLEAN NOT NULL DEFAULT true,
    `showCompletedMarks` BOOLEAN NOT NULL DEFAULT true,
    `showPrevNext` BOOLEAN NOT NULL DEFAULT true,
    `theaterModeEnabled` BOOLEAN NOT NULL DEFAULT true,
    `theaterButtonLabel` VARCHAR(60) NULL,
    `showResources` BOOLEAN NOT NULL DEFAULT true,
    `showLessonDescription` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `course_player_settings_courseId_key`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_pages` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `slug` VARCHAR(60) NOT NULL,
    `isEnabled` BOOLEAN NOT NULL DEFAULT true,
    `eyebrow` VARCHAR(120) NULL,
    `heading` VARCHAR(200) NULL,
    `intro` TEXT NULL,
    `heroImageUrl` VARCHAR(500) NULL,
    `ctaHeading` VARCHAR(200) NULL,
    `ctaText` VARCHAR(500) NULL,
    `ctaLabel` VARCHAR(100) NULL,
    `ctaUrl` VARCHAR(300) NULL,
    `seoTitle` VARCHAR(70) NULL,
    `metaDescription` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `site_pages_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `site_page_sections` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pageId` INTEGER NOT NULL,
    `title` VARCHAR(200) NULL,
    `body` TEXT NULL,
    `icon` VARCHAR(60) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `site_page_sections_pageId_sortOrder_idx`(`pageId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `navigation_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `label` VARCHAR(60) NOT NULL,
    `url` VARCHAR(300) NOT NULL,
    `location` ENUM('HEADER', 'FOOTER', 'BOTH') NOT NULL DEFAULT 'BOTH',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `openInNewTab` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `navigation_items_location_isPublished_sortOrder_idx`(`location`, `isPublished`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `home_intro_video` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `isEnabled` BOOLEAN NOT NULL DEFAULT false,
    `eyebrow` VARCHAR(120) NULL,
    `heading` VARCHAR(200) NULL,
    `highlightText` VARCHAR(120) NULL,
    `description` TEXT NULL,
    `videoType` VARCHAR(10) NULL,
    `videoUrl` VARCHAR(500) NULL,
    `videoObjectKey` VARCHAR(255) NULL,
    `posterUrl` VARCHAR(500) NULL,
    `ctaEnabled` BOOLEAN NOT NULL DEFAULT true,
    `ctaLabel` VARCHAR(100) NULL,
    `ctaUrl` VARCHAR(300) NULL,
    `secondaryCtaLabel` VARCHAR(100) NULL,
    `secondaryCtaUrl` VARCHAR(300) NULL,
    `layout` VARCHAR(20) NOT NULL DEFAULT 'VIDEO_RIGHT',
    `videoShape` VARCHAR(20) NOT NULL DEFAULT 'VERTICAL',
    `backgroundStyle` VARCHAR(20) NOT NULL DEFAULT 'CREAM',
    `autoplayMuted` BOOLEAN NOT NULL DEFAULT false,
    `loopVideo` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `course_player_settings` ADD CONSTRAINT `course_player_settings_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `site_page_sections` ADD CONSTRAINT `site_page_sections_pageId_fkey` FOREIGN KEY (`pageId`) REFERENCES `site_pages`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

