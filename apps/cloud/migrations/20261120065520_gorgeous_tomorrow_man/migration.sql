CREATE TABLE `group_exclusion` (
	`group_id` varchar(255) NOT NULL,
	`target` varchar(16) NOT NULL,
	`target_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`group_id`,`target`,`target_id`)
);
--> statement-breakpoint
CREATE TABLE `group_group` (
	`parent_group_id` varchar(255) NOT NULL,
	`child_group_id` varchar(255) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT PRIMARY KEY(`parent_group_id`,`child_group_id`)
);
--> statement-breakpoint
CREATE INDEX `group_exclusion_target_idx` ON `group_exclusion` (`target`,`target_id`);--> statement-breakpoint
CREATE INDEX `group_group_child_idx` ON `group_group` (`child_group_id`);--> statement-breakpoint
ALTER TABLE `group_exclusion` ADD CONSTRAINT `group_exclusion_group_id_enterprise_group_id_fkey` FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_group` ADD CONSTRAINT `group_group_parent_group_id_enterprise_group_id_fkey` FOREIGN KEY (`parent_group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `group_group` ADD CONSTRAINT `group_group_child_group_id_enterprise_group_id_fkey` FOREIGN KEY (`child_group_id`) REFERENCES `enterprise_group`(`id`) ON DELETE CASCADE;