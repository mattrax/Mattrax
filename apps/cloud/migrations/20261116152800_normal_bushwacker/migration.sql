CREATE TABLE `sso_assertion` (
	`jti` varchar(255) PRIMARY KEY,
	`expires_at` datetime(3) NOT NULL,
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sso_assertion_expires_idx` ON `sso_assertion` (`expires_at`);