-- AlterTable: instructors
ALTER TABLE `instructors`
    ADD COLUMN `designation` VARCHAR(255) NULL,
    ADD COLUMN `organization` VARCHAR(255) NULL,
    ADD COLUMN `experienceLabel` VARCHAR(100) NULL,
    ADD COLUMN `shortBio` TEXT NULL,
    ADD COLUMN `qualificationSummary` TEXT NULL,
    ADD COLUMN `practiceName` VARCHAR(255) NULL,
    ADD COLUMN `practiceLocation` VARCHAR(255) NULL,
    ADD COLUMN `mentorQuote` TEXT NULL;

-- AlterTable: course_landing_contents
ALTER TABLE `course_landing_contents`
    ADD COLUMN `accessLabel` VARCHAR(100) NULL,
    ADD COLUMN `whyRegisterEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `whyRegisterEyebrow` VARCHAR(100) NULL,
    ADD COLUMN `whyRegisterHeading` VARCHAR(255) NULL,
    ADD COLUMN `whyRegisterIntro` TEXT NULL,
    ADD COLUMN `whyRegisterEmphasisText` TEXT NULL,
    ADD COLUMN `whyRegisterWantHeading` VARCHAR(255) NULL DEFAULT 'This course is for you if you want to:',
    ADD COLUMN `whyRegisterGetHeading` VARCHAR(255) NULL DEFAULT 'What you get:',
    ADD COLUMN `whyRegisterClosingText` TEXT NULL,
    ADD COLUMN `highlightsEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `highlightsHeading` VARCHAR(255) NULL DEFAULT 'Course Highlights',
    ADD COLUMN `highlightsDescription` TEXT NULL,
    ADD COLUMN `reviewsEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `reviewsEyebrow` VARCHAR(100) NULL DEFAULT 'Student Reviews',
    ADD COLUMN `reviewsHeading` VARCHAR(255) NULL DEFAULT 'Reviews from dentists who transformed their practice with this masterclass',
    ADD COLUMN `reviewsIntro` TEXT NULL,
    ADD COLUMN `mentorSectionEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `mentorEyebrow` VARCHAR(100) NULL DEFAULT 'Meet Your Mentor',
    ADD COLUMN `mentorHeading` VARCHAR(255) NULL DEFAULT 'Learn from an Experienced Clinician';

-- CreateTable: instructor_credentials
CREATE TABLE `instructor_credentials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `instructorId` INTEGER NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(50) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `instructor_credentials_instructorId_sortOrder_idx`(`instructorId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_why_register_items
CREATE TABLE `course_why_register_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(50) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_why_register_items_courseId_type_sortOrder_idx`(`courseId`, `type`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_highlights
CREATE TABLE `course_highlights` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `title` VARCHAR(300) NOT NULL,
    `description` TEXT NULL,
    `icon` VARCHAR(50) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_highlights_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: course_testimonials
CREATE TABLE `course_testimonials` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `reviewerName` VARCHAR(255) NOT NULL,
    `reviewerDesignation` VARCHAR(255) NULL,
    `reviewerLocation` VARCHAR(255) NULL,
    `quote` TEXT NOT NULL,
    `rating` INTEGER NOT NULL DEFAULT 5,
    `avatarUrl` VARCHAR(500) NULL,
    `initials` VARCHAR(10) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `course_testimonials_courseId_sortOrder_idx`(`courseId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `instructor_credentials` ADD CONSTRAINT `instructor_credentials_instructorId_fkey` FOREIGN KEY (`instructorId`) REFERENCES `instructors`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_why_register_items` ADD CONSTRAINT `course_why_register_items_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_highlights` ADD CONSTRAINT `course_highlights_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `course_testimonials` ADD CONSTRAINT `course_testimonials_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
