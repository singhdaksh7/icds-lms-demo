-- CreateTable
CREATE TABLE `course_landing_contents` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `heroEyebrow` VARCHAR(255) NULL,
    `heroTitleOverride` VARCHAR(255) NULL,
    `heroAccentText` VARCHAR(255) NULL,
    `heroDescription` TEXT NULL,
    `heroMediaType` VARCHAR(50) NULL DEFAULT 'THUMBNAIL',
    `heroMediaUrl` VARCHAR(500) NULL,
    `heroMediaCaption` VARCHAR(255) NULL,
    `secondaryCtaLabel` VARCHAR(100) NULL DEFAULT 'Explore Curriculum',
    `secondaryCtaTarget` VARCHAR(255) NULL DEFAULT '#curriculum',
    `priceSubtitle` VARCHAR(100) NULL,
    `aboutEnabled` BOOLEAN NOT NULL DEFAULT true,
    `aboutEyebrow` VARCHAR(100) NULL,
    `aboutHeading` VARCHAR(255) NULL,
    `aboutBody` TEXT NULL,
    `takeawaysEnabled` BOOLEAN NOT NULL DEFAULT true,
    `takeawaysEyebrow` VARCHAR(100) NULL,
    `takeawaysHeading` VARCHAR(255) NULL,
    `takeawaysDescription` TEXT NULL,
    `sneakPeekEnabled` BOOLEAN NOT NULL DEFAULT true,
    `sneakPeekEyebrow` VARCHAR(100) NULL,
    `sneakPeekHeading` VARCHAR(255) NULL,
    `sneakPeekDescription` TEXT NULL,
    `sneakPeekMediaUrl` VARCHAR(500) NULL,
    `questionsEnabled` BOOLEAN NOT NULL DEFAULT true,
    `questionsEyebrow` VARCHAR(100) NULL,
    `questionsHeading` VARCHAR(255) NULL,
    `curriculumEnabled` BOOLEAN NOT NULL DEFAULT true,
    `curriculumEyebrow` VARCHAR(100) NULL,
    `curriculumHeading` VARCHAR(255) NULL,
    `curriculumIntro` TEXT NULL,
    `curriculumDefaultExpanded` BOOLEAN NOT NULL DEFAULT true,
    `showLessonDuration` BOOLEAN NOT NULL DEFAULT true,
    `showLockIcon` BOOLEAN NOT NULL DEFAULT true,
    `showPreviewBadge` BOOLEAN NOT NULL DEFAULT true,
    `certificateSectionEnabled` BOOLEAN NOT NULL DEFAULT false,
    `certificateEyebrow` VARCHAR(100) NULL DEFAULT 'E-Certificate',
    `certificateHeading` VARCHAR(255) NULL,
    `certificateBody` TEXT NULL,
    `certificateNote` VARCHAR(255) NULL,
    `audienceEnabled` BOOLEAN NOT NULL DEFAULT true,
    `audienceEyebrow` VARCHAR(100) NULL,
    `audienceHeading` VARCHAR(255) NULL,
    `audienceForHeading` VARCHAR(100) NULL DEFAULT 'Good fit for',
    `audienceNotForHeading` VARCHAR(100) NULL DEFAULT 'Probably not for',
    `faqEnabled` BOOLEAN NOT NULL DEFAULT true,
    `faqEyebrow` VARCHAR(100) NULL DEFAULT 'Questions & Answers',
    `faqHeading` VARCHAR(255) NULL DEFAULT 'Frequently asked course questions',
    `finalCtaEnabled` BOOLEAN NOT NULL DEFAULT true,
    `finalCtaEyebrow` VARCHAR(100) NULL DEFAULT 'Start Learning Today',
    `finalCtaHeading` VARCHAR(255) NULL,
    `finalCtaBody` TEXT NULL,
    `finalCtaButtonLabel` VARCHAR(100) NULL,
    `finalCtaBadgeText` VARCHAR(255) NULL,
    `stickyCtaEnabled` BOOLEAN NOT NULL DEFAULT true,
    `stickyCtaText` VARCHAR(255) NULL,
    `stickyCtaButtonLabel` VARCHAR(100) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `course_landing_contents_courseId_key`(`courseId`),
    INDEX `course_landing_contents_courseId_idx`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_hero_chips` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_hero_chips_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_takeaways` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NOT NULL,
    `icon` VARCHAR(50) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_takeaways_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_questions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `question` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_questions_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_audience_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_audience_items_courseId_type_sortOrder_idx`(`courseId`, `type`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `course_faqs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `question` VARCHAR(300) NOT NULL,
    `answer` TEXT NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_faqs_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `course_landing_contents` ADD CONSTRAINT `course_landing_contents_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_hero_chips` ADD CONSTRAINT `course_hero_chips_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_takeaways` ADD CONSTRAINT `course_takeaways_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_questions` ADD CONSTRAINT `course_questions_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_audience_items` ADD CONSTRAINT `course_audience_items_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_faqs` ADD CONSTRAINT `course_faqs_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
