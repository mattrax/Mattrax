CREATE TABLE `auth_passkeyCredentials` (
	`credential_id` varchar(191) NOT NULL,
	`subject_id` text NOT NULL,
	`rp_id` text NOT NULL,
	`protocol_credential_id` text NOT NULL,
	`credential_key` varchar(191) NOT NULL,
	`user_handle` text NOT NULL,
	`public_key` text NOT NULL,
	`algorithm` bigint NOT NULL,
	`profile` text NOT NULL,
	`credential_revision` text NOT NULL,
	`active` boolean NOT NULL,
	`primary_sign_in` boolean NOT NULL,
	`enrollment_user_verified` boolean NOT NULL,
	`backup_eligible` boolean NOT NULL,
	`backup_state` boolean NOT NULL,
	`counter` bigint NOT NULL,
	`name` text NOT NULL,
	`created_at` bigint NOT NULL,
	`last_used_at` bigint,
	CONSTRAINT `auth_passkeyCredentials_key_0` UNIQUE INDEX(`credential_id`),
	CONSTRAINT `auth_passkeyCredentials_key_1` UNIQUE INDEX(`credential_key`)
);
--> statement-breakpoint
CREATE TABLE `auth_passkeyFlows` (
	`module_id` varchar(191) NOT NULL,
	`flow_id` varchar(191) NOT NULL,
	`purpose` text NOT NULL,
	`snapshot` text NOT NULL,
	`request_binding_verifier` text NOT NULL,
	`request_binding_expires_at` bigint NOT NULL,
	`issued_at` bigint NOT NULL,
	`expires_at` bigint NOT NULL,
	CONSTRAINT `auth_passkeyFlows_key_0` UNIQUE INDEX(`module_id`,`flow_id`)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `passkey_enabled` boolean DEFAULT false NOT NULL;