-- AlterTable
ALTER TABLE `orders` ADD COLUMN `delivered_at` DATETIME(3) NULL,
    ADD COLUMN `driver_id` INTEGER NULL,
    ADD COLUMN `driver_latitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `driver_located_at` DATETIME(3) NULL,
    ADD COLUMN `driver_longitude` DECIMAL(9, 6) NULL,
    ADD COLUMN `picked_up_at` DATETIME(3) NULL,
    MODIFY `status` ENUM('pending_payment', 'placed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending_payment';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `driver_online` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `driver_store_id` INTEGER NULL,
    MODIFY `role` ENUM('customer', 'driver', 'admin') NOT NULL DEFAULT 'customer';

-- CreateIndex
CREATE INDEX `orders_driver_id_status_idx` ON `orders`(`driver_id`, `status`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_driver_store_id_fkey` FOREIGN KEY (`driver_store_id`) REFERENCES `stores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_driver_id_fkey` FOREIGN KEY (`driver_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
