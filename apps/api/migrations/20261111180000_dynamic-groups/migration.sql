ALTER TABLE `enterprise_group` ADD `kind` varchar(16) DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `enterprise_group` ADD `rules` json;--> statement-breakpoint
ALTER TABLE `enterprise_group` ADD `last_evaluated_at` datetime(3);--> statement-breakpoint
ALTER TABLE `group_device` ADD `source` varchar(16) DEFAULT 'manual' NOT NULL;