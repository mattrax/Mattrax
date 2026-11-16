CREATE TABLE `deployment_license` (
	`id` varchar(255) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`license_key_hash` varchar(255) NOT NULL,
	`license_key_prefix` varchar(255) NOT NULL,
	`origin` varchar(255),
	`contact_email` varchar(320),
	`stripe_customer_id` varchar(255),
	`stripe_subscription_id` varchar(255),
	`plan` varchar(255) NOT NULL DEFAULT 'device',
	`status` varchar(32),
	`device_count` int NOT NULL DEFAULT 0,
	`tenant_count` int NOT NULL DEFAULT 0,
	`period_end` datetime(3),
	`cancel_at_period_end` boolean NOT NULL DEFAULT false,
	`last_seen_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `deployment_license_key_unique` UNIQUE INDEX(`license_key_hash`),
	CONSTRAINT `deployment_license_customer_unique` UNIQUE INDEX(`stripe_customer_id`)
);
--> statement-breakpoint
CREATE INDEX `deployment_license_last_seen_idx` ON `deployment_license` (`last_seen_at`);