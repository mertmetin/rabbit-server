-- AlterTable
ALTER TABLE `users` MODIFY `name` VARCHAR(191) NOT NULL DEFAULT '',
    MODIFY `email` VARCHAR(191) NULL,
    MODIFY `password_hash` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `verification_codes` MODIFY `purpose` ENUM('activation', 'password_reset', 'login') NOT NULL;
