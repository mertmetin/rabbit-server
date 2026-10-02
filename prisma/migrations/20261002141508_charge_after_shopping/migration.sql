-- AlterTable
ALTER TABLE `orders` ADD COLUMN `substitutions` ENUM('similar', 'skip') NOT NULL DEFAULT 'similar',
    ADD COLUMN `captured_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `found_quantity` INTEGER NULL;
