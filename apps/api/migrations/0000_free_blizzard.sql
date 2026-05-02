CREATE TABLE `scep_ca` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cert_pem` text NOT NULL,
	`private_key_jwk` text NOT NULL,
	`created_at` integer NOT NULL
);
