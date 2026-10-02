-- AlterTable
ALTER TABLE `users` ADD COLUMN `google_sub` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `users_google_sub_key` ON `users`(`google_sub`);
