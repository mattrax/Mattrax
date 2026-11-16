CREATE TABLE `mcp_oauth_client` (
	`id` varchar(255) PRIMARY KEY,
	`name` varchar(255) NOT NULL,
	`redirect_uris` json NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`last_used_at` datetime(3)
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_code` (
	`id` varchar(255) PRIMARY KEY,
	`connection_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`code_hash` varchar(255) NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` varchar(255) NOT NULL,
	`code_challenge_method` varchar(16) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`consumed_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `mcp_oauth_code_hash_unique` UNIQUE INDEX(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_connection` (
	`id` varchar(255) PRIMARY KEY,
	`user_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`scopes` json NOT NULL,
	`last_used_at` datetime(3),
	`last_action` varchar(255),
	`request_count` int NOT NULL DEFAULT 0,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_token` (
	`id` varchar(255) PRIMARY KEY,
	`connection_id` varchar(255) NOT NULL,
	`client_id` varchar(255) NOT NULL,
	`kind` varchar(16) NOT NULL,
	`token_hash` varchar(255) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`last_used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `mcp_oauth_token_hash_unique` UNIQUE INDEX(`token_hash`)
);
--> statement-breakpoint
CREATE INDEX `mcp_oauth_client_created_idx` ON `mcp_oauth_client` (`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_code_connection_idx` ON `mcp_oauth_code` (`connection_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_connection_user_idx` ON `mcp_oauth_connection` (`user_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_connection_client_idx` ON `mcp_oauth_connection` (`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_token_connection_idx` ON `mcp_oauth_token` (`connection_id`);--> statement-breakpoint
ALTER TABLE `mcp_oauth_code` ADD CONSTRAINT `mcp_oauth_code_connection_id_mcp_oauth_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `mcp_oauth_connection`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `mcp_oauth_connection` ADD CONSTRAINT `mcp_oauth_connection_user_id_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `mcp_oauth_connection` ADD CONSTRAINT `mcp_oauth_connection_client_id_mcp_oauth_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `mcp_oauth_client`(`id`) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `mcp_oauth_token` ADD CONSTRAINT `mcp_oauth_token_connection_id_mcp_oauth_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `mcp_oauth_connection`(`id`) ON DELETE CASCADE;