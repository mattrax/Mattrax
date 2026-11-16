ALTER TABLE `device_policy` ADD `mode` varchar(16) DEFAULT 'include' NOT NULL;--> statement-breakpoint
ALTER TABLE `group_policy` ADD `mode` varchar(16) DEFAULT 'include' NOT NULL;--> statement-breakpoint
ALTER TABLE `policy` ADD `priority` int DEFAULT 0 NOT NULL;