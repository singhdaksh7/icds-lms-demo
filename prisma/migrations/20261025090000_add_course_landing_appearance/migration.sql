-- CreateTable (additive only: new table, no existing table/column is touched)
CREATE TABLE `course_landing_appearances` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `courseId` INTEGER NOT NULL,
    `themePreset` VARCHAR(40) NULL,
    `primaryColor` VARCHAR(9) NOT NULL DEFAULT '#2b6cf0',
    `secondaryColor` VARCHAR(9) NOT NULL DEFAULT '#0a1330',
    `accentColor` VARCHAR(9) NOT NULL DEFAULT '#f2b33d',
    `pageBackground` VARCHAR(9) NOT NULL DEFAULT '#f7faff',
    `surfaceColor` VARCHAR(9) NOT NULL DEFAULT '#ffffff',
    `alternateSurfaceColor` VARCHAR(9) NOT NULL DEFAULT '#f7faff',
    `headingColor` VARCHAR(9) NOT NULL DEFAULT '#0f1b33',
    `bodyTextColor` VARCHAR(9) NOT NULL DEFAULT '#1b2745',
    `mutedTextColor` VARCHAR(9) NOT NULL DEFAULT '#5b6a86',
    `borderColor` VARCHAR(9) NOT NULL DEFAULT '#dfe8f7',
    `buttonBackground` VARCHAR(9) NOT NULL DEFAULT '#2b6cf0',
    `buttonTextColor` VARCHAR(9) NOT NULL DEFAULT '#ffffff',
    `buttonHoverBackground` VARCHAR(9) NOT NULL DEFAULT '#2b6cf0',
    `buttonHoverTextColor` VARCHAR(9) NOT NULL DEFAULT '#ffffff',
    `heroBackground` VARCHAR(9) NOT NULL DEFAULT '#0a1330',
    `heroTextColor` VARCHAR(9) NOT NULL DEFAULT '#ffffff',
    `heroAccentColor` VARCHAR(9) NOT NULL DEFAULT '#f2b33d',
    `statsBackground` VARCHAR(9) NOT NULL DEFAULT '#ffffff',
    `statsAccentColor` VARCHAR(9) NOT NULL DEFAULT '#0a1330',
    `successColor` VARCHAR(9) NOT NULL DEFAULT '#14a066',
    `dangerColor` VARCHAR(9) NOT NULL DEFAULT '#e11d48',
    `glowColor` VARCHAR(9) NOT NULL DEFAULT '#172d69',
    `gradientStart` VARCHAR(9) NOT NULL DEFAULT '#2b6cf0',
    `gradientEnd` VARCHAR(9) NOT NULL DEFAULT '#9b5cf0',
    `cardRadius` VARCHAR(20) NOT NULL DEFAULT 'rounded',
    `buttonRadius` VARCHAR(20) NOT NULL DEFAULT 'soft',
    `shadowStrength` VARCHAR(20) NOT NULL DEFAULT 'subtle',
    `headingFont` VARCHAR(40) NOT NULL DEFAULT 'Fraunces',
    `bodyFont` VARCHAR(40) NOT NULL DEFAULT 'Inter',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `course_landing_appearances_courseId_key`(`courseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `course_landing_appearances` ADD CONSTRAINT `course_landing_appearances_courseId_fkey` FOREIGN KEY (`courseId`) REFERENCES `courses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
