DROP TABLE `auth_emailCredentials`;--> statement-breakpoint
DROP TABLE `auth_passwords`;--> statement-breakpoint
DROP TABLE `auth_proofs`;--> statement-breakpoint
ALTER TABLE `auth_passkeyFlows` ADD `application_snapshot` text;