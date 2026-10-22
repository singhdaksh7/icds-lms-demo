-- AlterTable: course_testimonials
ALTER TABLE `course_testimonials`
    ADD COLUMN `isDemo` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `course_testimonials_courseId_isPublished_isDemo_idx` ON `course_testimonials`(`courseId`, `isPublished`, `isDemo`);
