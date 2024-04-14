CREATE TABLE `account_login_codes` (
	`code` varchar(8) NOT NULL,
	`account` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_login_codes_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(16) NOT NULL,
	`email` varchar(256) NOT NULL,
	`name` varchar(256) NOT NULL,
	`features` json,
	CONSTRAINT `accounts_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `accounts_id_unique` UNIQUE(`id`),
	CONSTRAINT `accounts_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `apps` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` varchar(256),
	`tenant` bigint unsigned NOT NULL,
	CONSTRAINT `apps_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `apps_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`tenant` bigint unsigned NOT NULL,
	`action` enum('addIdp','removeIdp','connectDomain','disconnectDomain','addDevice','deviceAction','removeDevice','addPolicy','deployPolicy','deletePolicy','addApp','editApp','removeApp','addGroup','editGroup','removeGroup') NOT NULL,
	`data` json NOT NULL,
	`user_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `certificates` (
	`key` varchar(256) NOT NULL,
	`certificate` varbinary(9068) NOT NULL,
	`last_modified` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `certificates_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
CREATE TABLE `cli_auth_codes` (
	`code` varchar(24) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`session` varchar(255),
	CONSTRAINT `cli_auth_codes_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `device_actions` (
	`action` enum('restart','shutdown','lost','wipe','retire') NOT NULL,
	`device` bigint unsigned NOT NULL,
	`created_by` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`deployed_at` timestamp,
	CONSTRAINT `device_actions_action_device_pk` PRIMARY KEY(`action`,`device`)
);
--> statement-breakpoint
CREATE TABLE `devices` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`name` varchar(256) NOT NULL,
	`description` varchar(256),
	`enrollment_type` enum('user','device') NOT NULL,
	`os` enum('Windows','iOS','macOS','tvOS','Android','ChromeOS') NOT NULL,
	`serial_number` varchar(256) NOT NULL,
	`manufacturer` varchar(256),
	`model` varchar(256),
	`os_version` varchar(256),
	`imei` varchar(256),
	`free_storage` bigint unsigned,
	`total_storage` bigint unsigned,
	`owner` bigint unsigned,
	`azure_ad_did` varchar(256),
	`enrolled_at` timestamp NOT NULL DEFAULT (now()),
	`last_synced` timestamp NOT NULL DEFAULT (now()),
	`tenant` bigint unsigned NOT NULL,
	CONSTRAINT `devices_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `devices_id_unique` UNIQUE(`id`),
	CONSTRAINT `devices_serial_number_unique` UNIQUE(`serial_number`),
	CONSTRAINT `devices_azure_ad_did_unique` UNIQUE(`azure_ad_did`)
);
--> statement-breakpoint
CREATE TABLE `domains` (
	`domain` varchar(256) NOT NULL,
	`tenant` bigint unsigned NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`enterprise_enrollment_available` boolean NOT NULL DEFAULT false,
	`identity_provider` bigint unsigned NOT NULL,
	CONSTRAINT `domains_domain` PRIMARY KEY(`domain`)
);
--> statement-breakpoint
CREATE TABLE `group_assignables` (
	`group` bigint unsigned NOT NULL,
	`pk` bigint unsigned NOT NULL,
	`variant` enum('user','device') NOT NULL,
	CONSTRAINT `group_assignables_group_pk_variant_pk` PRIMARY KEY(`group`,`pk`,`variant`)
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`name` varchar(256) NOT NULL,
	`tenant` bigint unsigned NOT NULL,
	CONSTRAINT `groups_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `groups_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE TABLE `identity_providers` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`name` varchar(256),
	`provider` enum('entraId') NOT NULL,
	`tenant` bigint unsigned NOT NULL,
	`linker_upn` varchar(256),
	`linker_refresh_token` varchar(1024),
	`remote_id` varchar(256) NOT NULL,
	`last_synced` timestamp,
	CONSTRAINT `identity_providers_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `identity_providers_id_unique` UNIQUE(`id`),
	CONSTRAINT `identity_providers_tenant_unique` UNIQUE(`tenant`),
	CONSTRAINT `identity_providers_provider_remote_id_unique` UNIQUE(`provider`,`remote_id`)
);
--> statement-breakpoint
CREATE TABLE `oranisation_account` (
	`org` bigint unsigned NOT NULL,
	`account` bigint unsigned NOT NULL,
	CONSTRAINT `oranisation_account_org_account_pk` PRIMARY KEY(`org`,`account`)
);
--> statement-breakpoint
CREATE TABLE `organisation_invites` (
	`code` varchar(256) NOT NULL,
	`org` bigint unsigned NOT NULL,
	`email` varchar(256) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `organisation_invites_code` PRIMARY KEY(`code`),
	CONSTRAINT `organisation_invites_org_email_unique` UNIQUE(`org`,`email`)
);
--> statement-breakpoint
CREATE TABLE `organisation_members` (
	`org` bigint unsigned NOT NULL,
	`account` bigint unsigned NOT NULL,
	CONSTRAINT `organisation_members_org_account_pk` PRIMARY KEY(`org`,`account`)
);
--> statement-breakpoint
CREATE TABLE `organisations` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(256) NOT NULL,
	`billing_email` varchar(256),
	`stripe_customer_id` varchar(256),
	`owner` bigint unsigned NOT NULL,
	CONSTRAINT `organisations_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `organisations_id_unique` UNIQUE(`id`),
	CONSTRAINT `organisations_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `policies` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`priority` tinyint unsigned NOT NULL DEFAULT 128,
	`name` varchar(256) NOT NULL,
	`data` json NOT NULL DEFAULT ('{}'),
	`tenant` bigint unsigned NOT NULL,
	`last_modified` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policies_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `policies_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE TABLE `policy_assignables` (
	`policy` bigint unsigned NOT NULL,
	`pk` bigint unsigned NOT NULL,
	`variant` enum('user','device','group') NOT NULL,
	CONSTRAINT `policy_assignables_policy_pk_variant_pk` PRIMARY KEY(`policy`,`pk`,`variant`)
);
--> statement-breakpoint
CREATE TABLE `policy_deploy` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`policy` bigint unsigned NOT NULL,
	`data` json NOT NULL DEFAULT ('{}'),
	`comment` varchar(256) NOT NULL,
	`author` bigint unsigned NOT NULL,
	`done_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policy_deploy_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `policy_deploy_id_unique` UNIQUE(`id`)
);
--> statement-breakpoint
CREATE TABLE `policy_deploy_status` (
	`deploy` bigint unsigned NOT NULL,
	`device` bigint unsigned NOT NULL,
	`key` varchar(256) NOT NULL,
	`status` enum('success','failed') NOT NULL,
	`data` json NOT NULL,
	`done_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policy_deploy_status_deploy_key_pk` PRIMARY KEY(`deploy`,`key`)
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(255) NOT NULL,
	`account` varchar(255) NOT NULL,
	`user_agent` varchar(256) NOT NULL,
	`location` varchar(256) NOT NULL,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `session_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenant` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`name` varchar(100) NOT NULL,
	`slug` varchar(256) NOT NULL,
	`org` bigint unsigned,
	CONSTRAINT `tenant_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `tenant_id_unique` UNIQUE(`id`),
	CONSTRAINT `tenant_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`pk` serial AUTO_INCREMENT NOT NULL,
	`id` varchar(24) NOT NULL,
	`name` varchar(256) NOT NULL,
	`email` varchar(256) NOT NULL,
	`tenant` bigint unsigned NOT NULL,
	`provider` bigint unsigned NOT NULL,
	`resource_id` varchar(256),
	CONSTRAINT `users_pk` PRIMARY KEY(`pk`),
	CONSTRAINT `users_id_unique` UNIQUE(`id`),
	CONSTRAINT `users_email_tenant_unique` UNIQUE(`email`,`tenant`),
	CONSTRAINT `users_resource_id_provider_unique` UNIQUE(`resource_id`,`provider`)
);
--> statement-breakpoint
CREATE TABLE `waitlist` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`email` varchar(256) NOT NULL,
	`name` varchar(256),
	`interest` enum('personal','internal-it-team','msp-provider','other') NOT NULL,
	`deployment` enum('managed-cloud','private-cloud','onprem','other') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `waitlist_id` PRIMARY KEY(`id`),
	CONSTRAINT `waitlist_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `windows_ephemeral_state` (
	`session_id` varchar(256) NOT NULL,
	`msg_id` varchar(256) NOT NULL,
	`cmd_id` varchar(256) NOT NULL,
	`deploy` bigint unsigned NOT NULL,
	`key` varchar(256) NOT NULL,
	CONSTRAINT `windows_ephemeral_state_session_id_msg_id_cmd_id_pk` PRIMARY KEY(`session_id`,`msg_id`,`cmd_id`)
);
--> statement-breakpoint
SELECT 1