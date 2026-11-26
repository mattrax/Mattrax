CREATE TABLE `member_scope_tag` (
	`organization_id` varchar(255) NOT NULL,
	`member_id` varchar(255) NOT NULL,
	`tag_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`member_id`,`tag_id`)
);
--> statement-breakpoint
CREATE TABLE `scope_tag` (
	`id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `scope_tag_organization_name_unique` UNIQUE INDEX(`organization_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `scope_tag_assignment` (
	`organization_id` varchar(255) NOT NULL,
	`resource_type` varchar(24) NOT NULL,
	`resource_id` varchar(64) NOT NULL,
	`tag_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`organization_id`,`resource_type`,`resource_id`,`tag_id`)
);
--> statement-breakpoint
ALTER TABLE `invitation` ADD `scope_tag_ids` json;--> statement-breakpoint
CREATE INDEX `member_scope_tag_organization_idx` ON `member_scope_tag` (`organization_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `member_scope_tag_tag_idx` ON `member_scope_tag` (`tag_id`);--> statement-breakpoint
CREATE INDEX `scope_tag_assignment_scope_idx` ON `scope_tag_assignment` (`organization_id`,`resource_type`,`tag_id`);--> statement-breakpoint
CREATE INDEX `scope_tag_assignment_tag_idx` ON `scope_tag_assignment` (`tag_id`);--> statement-breakpoint
ALTER TABLE `member_scope_tag` ADD CONSTRAINT `member_scope_tag_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `member_scope_tag` ADD CONSTRAINT `member_scope_tag_member_id_member_id_fkey` FOREIGN KEY (`member_id`) REFERENCES `member`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `member_scope_tag` ADD CONSTRAINT `member_scope_tag_tag_id_scope_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `scope_tag`(`id`) ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE `scope_tag` ADD CONSTRAINT `scope_tag_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `scope_tag_assignment` ADD CONSTRAINT `scope_tag_assignment_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `scope_tag_assignment` ADD CONSTRAINT `scope_tag_assignment_tag_id_scope_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `scope_tag`(`id`) ON DELETE CASCADE;