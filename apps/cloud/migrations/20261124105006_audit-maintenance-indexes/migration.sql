CREATE INDEX `audit_log_organization_action_created_idx` ON `audit_log` (`organization_id`,`action`,`created_at` desc,`id` desc);--> statement-breakpoint
DROP INDEX `audit_log_organization_action_idx` ON `audit_log`;--> statement-breakpoint
CREATE INDEX `webhook_delivery_status_created_attempt_idx` ON `webhook_delivery` (`status`,`created_at`,`attempt`);--> statement-breakpoint
DROP INDEX `webhook_delivery_status_attempt_idx` ON `webhook_delivery`;--> statement-breakpoint
CREATE INDEX `audit_log_organization_category_created_idx` ON `audit_log` (`organization_id`,`category`,`created_at` desc,`id` desc);--> statement-breakpoint
CREATE INDEX `audit_log_organization_protocol_created_idx` ON `audit_log` (`organization_id`,`protocol`,`created_at` desc,`id` desc);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_session_idx` ON `auth_sessions` (`expires_at`,`session_id`);--> statement-breakpoint
CREATE INDEX `device_status_last_seen_idx` ON `device` (`status`,`last_seen_at`);