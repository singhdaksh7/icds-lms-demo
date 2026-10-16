-- AlterTable
ALTER TABLE `categories` ADD COLUMN `imageUrl` VARCHAR(500) NULL;

-- Keep today's category photography: the four bundled demo images used to be
-- chosen in code by slug. They are now ordinary per-category data (editable or
-- removable in Admin > Categories). Only fills categories that have no image.
UPDATE `categories` SET `imageUrl` = '/images/demo/category-cosmetology.jpg' WHERE `slug` = 'cosmetology' AND `imageUrl` IS NULL;
UPDATE `categories` SET `imageUrl` = '/images/demo/category-aesthetics.jpg' WHERE `slug` = 'aesthetics' AND `imageUrl` IS NULL;
UPDATE `categories` SET `imageUrl` = '/images/demo/category-dental.jpg' WHERE `slug` = 'dental-sciences' AND `imageUrl` IS NULL;
UPDATE `categories` SET `imageUrl` = '/images/demo/category-skin-hair.jpg' WHERE `slug` = 'skin-hair' AND `imageUrl` IS NULL;
