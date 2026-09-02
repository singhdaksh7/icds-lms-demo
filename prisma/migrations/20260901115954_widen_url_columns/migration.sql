-- AlterTable
ALTER TABLE `certificates` MODIFY `fileUrl` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `courses` MODIFY `thumbnailUrl` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `instructors` MODIFY `photoUrl` VARCHAR(500) NULL,
    MODIFY `linkedinUrl` VARCHAR(500) NULL,
    MODIFY `instagramUrl` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `lessons` MODIFY `videoUrl` VARCHAR(500) NULL;
