CREATE TABLE `android_device` (
	`device_id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`enterprise_name` varchar(255) NOT NULL,
	`device_name` varchar(255) NOT NULL,
	`policy_id` varchar(255),
	`policy_hash` varchar(255),
	`state` varchar(32),
	`last_error` text,
	`last_synced_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `android_device_name_unique` UNIQUE INDEX(`organization_id`,`device_name`)
);
--> statement-breakpoint
CREATE TABLE `android_enterprise` (
	`organization_id` varchar(255) PRIMARY KEY,
	`enterprise_name` varchar(255),
	`signup_url` varchar(255),
	`signup_state` varchar(255),
	`pubsub_topic` varchar(255),
	`pubsub_subscription` varchar(255),
	`service_account_email` varchar(320),
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`last_error` text,
	`last_synced_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `android_enterprise_name_unique` UNIQUE INDEX(`enterprise_name`)
);
--> statement-breakpoint
CREATE TABLE `android_pubsub_message` (
	`message_id` varchar(255) PRIMARY KEY,
	`organization_id` varchar(255) NOT NULL,
	`notification_type` varchar(255),
	`received_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `android_device_organization_idx` ON `android_device` (`organization_id`);--> statement-breakpoint
CREATE INDEX `android_pubsub_message_organization_idx` ON `android_pubsub_message` (`organization_id`,`received_at`);--> statement-breakpoint
ALTER TABLE `android_device` ADD CONSTRAINT `android_device_device_id_device_id_fkey` FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `android_device` ADD CONSTRAINT `android_device_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `android_enterprise` ADD CONSTRAINT `android_enterprise_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `android_pubsub_message` ADD CONSTRAINT `android_pubsub_message_organization_id_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON DELETE CASCADE;