-- AlterTable
ALTER TABLE `orders` ADD COLUMN `tip_cents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `rating` INTEGER NULL,
    ADD COLUMN `rating_comment` TEXT NULL,
    ADD COLUMN `rated_at` DATETIME(3) NULL,
    ADD COLUMN `extra_tip_cents` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `extra_tip_payment_intent_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `orders_extra_tip_payment_intent_id_key` ON `orders`(`extra_tip_payment_intent_id`);
