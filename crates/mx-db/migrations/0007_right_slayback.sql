ALTER TABLE `users` RENAME COLUMN `email` TO `upn`;--> statement-breakpoint
ALTER TABLE `users` DROP INDEX `users_email_tenant_unique`;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_upn_tenant_unique` UNIQUE(`upn`,`tenant`);