-- AlterTable
ALTER TABLE `orders` ADD COLUMN `contactless` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `no_bell` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `notes` TEXT NULL,
    ADD COLUMN `placed_at` DATETIME(3) NULL;
