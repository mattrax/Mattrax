-- Drizzle's MySQL generator emitted these foreign keys without delete rules.
-- Align them with the application's cascade/nullify intent so tenant and user
-- deletion cannot be blocked by audit, command or push-key history.
ALTER TABLE `audit_log` DROP FOREIGN KEY `audit_log_organization_id_organization_id_fkey`;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `audit_log` DROP FOREIGN KEY `audit_log_actor_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_user_id_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `device_command` DROP FOREIGN KEY `device_command_organization_id_organization_id_fkey`;
--> statement-breakpoint
ALTER TABLE `device_command` ADD CONSTRAINT `device_command_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `device_command` DROP FOREIGN KEY `device_command_device_id_device_id_fkey`;
--> statement-breakpoint
ALTER TABLE `device_command` ADD CONSTRAINT `device_command_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `apple_push_key` DROP FOREIGN KEY `apple_push_key_organization_id_organization_id_fkey`;
--> statement-breakpoint
ALTER TABLE `apple_push_key` ADD CONSTRAINT `apple_push_key_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;
