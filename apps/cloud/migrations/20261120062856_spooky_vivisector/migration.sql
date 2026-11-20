CREATE TABLE `software_update_feed` (
	`id` varchar(64) PRIMARY KEY,
	`source_url` text NOT NULL,
	`payload` json,
	`fetched_at` datetime(3),
	`checked_at` datetime(3) NOT NULL,
	`last_error` varchar(64)
);
