CREATE TABLE `step_up_totp_state` (
	`subject_id` varchar(255) PRIMARY KEY,
	`last_accepted_step` int NOT NULL DEFAULT 0,
	`failures` int NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`updated_at` datetime(3) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `step_up_totp_state_locked_idx` ON `step_up_totp_state` (`locked_until`);