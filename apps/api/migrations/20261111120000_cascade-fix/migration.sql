-- `enrollment_attempt` was generated without a delete rule, so deleting a
-- tenant failed as soon as any enrollment link had been visited. `upsert` is
-- used so the migration is safe on databases where the FK was already fixed.
ALTER TABLE `enrollment_attempt` DROP FOREIGN KEY `enrollment_attempt_organization_id_organization_id_fkey`;
--> statement-breakpoint
ALTER TABLE `enrollment_attempt` ADD CONSTRAINT `enrollment_attempt_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
-- `platform_instance` was also missing the cascade rule its schema declares,
-- which blocks deleting a user who issued an instance.
ALTER TABLE `platform_instance` DROP FOREIGN KEY `platform_instance_issued_by_user_id_user_id_fkey`;
--> statement-breakpoint
ALTER TABLE `platform_instance` ADD CONSTRAINT `platform_instance_issued_by_user_id_user_id_fkey` FOREIGN KEY (`issued_by_user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;
