CREATE TABLE `auth_emailCredentials` (
	`module_id` varchar(191) NOT NULL,
	`subject_id` text NOT NULL,
	`credential_id` varchar(191) NOT NULL,
	`identifier_namespace` varchar(191) NOT NULL,
	`identifier_value` varchar(191) NOT NULL,
	`credential_revision` text NOT NULL,
	`active` boolean NOT NULL,
	CONSTRAINT `auth_emailCredentials_key_0` UNIQUE INDEX(`module_id`,`credential_id`),
	CONSTRAINT `auth_emailCredentials_key_1` UNIQUE INDEX(`module_id`,`identifier_namespace`,`identifier_value`)
);
