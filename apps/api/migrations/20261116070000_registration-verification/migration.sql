CREATE TABLE `registration_verification` (
	`email` varchar(320) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`code_hash` varchar(128) NOT NULL,
	`grant` varchar(128) NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`expires_at` datetime(3) NOT NULL,
	`verified_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL
);
