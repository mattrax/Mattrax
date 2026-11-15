CREATE INDEX `audit_log_actor_action_idx` ON `audit_log` (`actor_user_id`,`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_welcome_email_sweep_idx` ON `user` (`source`,`welcome_email_sent_at`,`created_at`);
