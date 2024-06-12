ALTER TABLE `users` RENAME COLUMN `email` TO `upn`;
ALTER TABLE `users` DROP INDEX `users_email_tenant_unique`;
ALTER TABLE `users` ADD CONSTRAINT `users_upn_tenant_unique` UNIQUE(`upn`,`tenant`);