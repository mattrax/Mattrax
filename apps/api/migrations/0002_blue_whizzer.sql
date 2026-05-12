CREATE TABLE `apple_push_certificate` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`topic` text NOT NULL,
	`cert_pem` text NOT NULL,
	`encrypted_key` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `configuration` (
	`kind` text NOT NULL,
	`policy_id` text NOT NULL,
	`data` text NOT NULL,
	`hash` text NOT NULL,
	PRIMARY KEY(`kind`, `policy_id`),
	FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `device` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`proto` text NOT NULL,
	`status` text DEFAULT 'enrolling' NOT NULL,
	`name` text NOT NULL,
	`model` text,
	`model_identifier` text,
	`serial` text,
	`enrolled_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`notes` text,
	`asset_tag` text,
	`physical_name` text,
	`vendor` text,
	`os_edition` text,
	`os_version` text,
	`os_build` text,
	`disk_total` text,
	`disk_used` text,
	`dm_identifier` text,
	`dm_cert_hash` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `device_organization_id_idx` ON `device` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `device_serial_unique` ON `device` (`serial`);--> statement-breakpoint
CREATE TABLE `device_apple` (
	`device_id` text PRIMARY KEY NOT NULL,
	`token` text,
	`push_magic` text,
	`topic` text,
	`unlock_token` text,
	`token_updated_at` integer,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `enterprise_enrollment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`code` text,
	`enabled_apple` integer DEFAULT true NOT NULL,
	`enabled_windows` integer DEFAULT true NOT NULL,
	`enabled_android` integer DEFAULT false NOT NULL,
	`enabled_asset_tag` integer DEFAULT false NOT NULL,
	`max_devices` integer DEFAULT 100 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `enterprise_group` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `enterprise_group_organization_id_idx` ON `enterprise_group` (`organization_id`);--> statement-breakpoint
CREATE TABLE `group_device` (
	`group_id` text NOT NULL,
	`device_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `device_id`),
	FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `group_policy` (
	`group_id` text NOT NULL,
	`policy_id` text NOT NULL,
	PRIMARY KEY(`group_id`, `policy_id`),
	FOREIGN KEY (`group_id`) REFERENCES `enterprise_group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_id`) REFERENCES `policy`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`inviter_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organization_id_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_user_organization_unique` ON `member` (`user_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `member_organization_id_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`stripe_customer_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `organization_device_usage` (
	`organization_id` text NOT NULL,
	`period` text NOT NULL,
	`billable_devices` integer NOT NULL,
	`stripe_subscription_item_id` text,
	`last_reported_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `period`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `policy` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `policy_organization_id_idx` ON `policy` (`organization_id`);--> statement-breakpoint
CREATE TABLE `subscription` (
	`id` text PRIMARY KEY NOT NULL,
	`plan` text NOT NULL,
	`reference_id` text NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`status` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`cancel_at_period_end` integer,
	`cancel_at` integer,
	`canceled_at` integer,
	`ended_at` integer,
	`seats` integer,
	`trial_start` integer,
	`trial_end` integer,
	`billing_interval` text,
	`stripe_schedule_id` text
);
--> statement-breakpoint
CREATE INDEX `subscription_reference_id_idx` ON `subscription` (`reference_id`);--> statement-breakpoint
ALTER TABLE `session` ADD `active_organization_id` text;--> statement-breakpoint
ALTER TABLE `user` ADD `stripe_customer_id` text;