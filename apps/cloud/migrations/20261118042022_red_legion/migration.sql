ALTER TABLE `device` ADD `windows_activation_status` varchar(16);--> statement-breakpoint
ALTER TABLE `device` ADD `windows_activation_license_status` int;--> statement-breakpoint
ALTER TABLE `device` ADD `windows_activation_edition` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `windows_activation_channel` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `windows_activation_license_name` varchar(255);--> statement-breakpoint
ALTER TABLE `device` ADD `windows_activation_updated_at` datetime(3);