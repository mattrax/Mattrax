CREATE TABLE `passkey_challenges` (
	`challenge` varchar(256) NOT NULL,
	CONSTRAINT `passkey_challenges_challenge` PRIMARY KEY(`challenge`)
);

CREATE TABLE `passkeys` (
	`account` bigint unsigned NOT NULL,
	`public_key` text NOT NULL,
	`credential_id` varchar(128) NOT NULL,
	`counter` int NOT NULL,
	`transports` json,
	CONSTRAINT `passkeys_credential_id` PRIMARY KEY(`credential_id`),
	CONSTRAINT `passkeys_account_unique` UNIQUE(`account`)
);

ALTER TABLE `passkeys` ADD CONSTRAINT `passkeys_account_accounts_pk_fk` FOREIGN KEY (`account`) REFERENCES `accounts`(`pk`) ON DELETE no action ON UPDATE no action;