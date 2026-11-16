ALTER TABLE `policy_deployment` DROP FOREIGN KEY `policy_deployment_organization_id_organization_id_fkey`;
--> statement-breakpoint
ALTER TABLE `policy_deployment` DROP FOREIGN KEY `policy_deployment_policy_id_policy_id_fkey`;
--> statement-breakpoint
ALTER TABLE `policy_deployment` ADD CONSTRAINT `policy_deployment_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `policy_deployment` ADD CONSTRAINT `policy_deployment_policy_id_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON DELETE CASCADE;
