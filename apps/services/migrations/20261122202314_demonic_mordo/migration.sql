CREATE TABLE `services_deployment_license` (
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
	CONSTRAINT `services_deployment_license_key_unique` UNIQUE INDEX(`license_key_hash`),
	CONSTRAINT `services_deployment_license_customer_unique` UNIQUE INDEX(`stripe_customer_id`)
);
--> statement-breakpoint
CREATE TABLE `services_stripe_event` (
	`id` varchar(255) PRIMARY KEY,
	`type` varchar(255) NOT NULL,
	`tenant_id` varchar(255),
	`license_id` varchar(255),
	`received_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services_subscription` (
	`id` varchar(255) PRIMARY KEY,
	`plan` varchar(255) NOT NULL,
	`tenant_id` varchar(255) NOT NULL,
	`stripe_customer_id` varchar(255),
	`stripe_subscription_id` varchar(255),
	`status` varchar(32) NOT NULL,
	`period_start` datetime(3),
	`period_end` datetime(3),
	`cancel_at_period_end` boolean,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `services_subscription_tenant_unique` UNIQUE INDEX(`tenant_id`),
	CONSTRAINT `services_subscription_stripe_unique` UNIQUE INDEX(`stripe_subscription_id`)
);
--> statement-breakpoint
CREATE TABLE `services_tenant` (
	`id` varchar(255) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`stripe_customer_id` varchar(255),
	`entitlement_synced_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `services_tenant_customer_unique` UNIQUE INDEX(`stripe_customer_id`)
);
--> statement-breakpoint
CREATE TABLE `services_tenant_usage` (
	`tenant_id` varchar(255) PRIMARY KEY,
	`billable_devices` int NOT NULL DEFAULT 0,
	`devices_used` int NOT NULL DEFAULT 0,
	`tenant_count` int NOT NULL DEFAULT 0,
	`reported_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `services_stripe_event_received_at_idx` ON `services_stripe_event` (`received_at`);