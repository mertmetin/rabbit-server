-- AlterTable
ALTER TABLE `products` ADD COLUMN `group_id` INTEGER NULL,
    ADD COLUMN `options` JSON NULL;

-- CreateTable
CREATE TABLE `product_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `options` JSON NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `products_group_id_idx` ON `products`(`group_id`);

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `product_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
