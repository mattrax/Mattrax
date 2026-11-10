ALTER TABLE `account_api_token` ADD `tenant_id` varchar(255);--> statement-breakpoint
ALTER TABLE `account_api_token` ADD `scopes` json;--> statement-breakpoint
CREATE INDEX `account_api_token_tenant_id_idx` ON `account_api_token` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `account_api_token` ADD CONSTRAINT `account_api_token_tenant_id_organization_id_fkey` FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
UPDATE `account_api_token` SET `scopes` = JSON_ARRAY('read', 'write') WHERE `scopes` IS NULL;