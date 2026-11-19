DROP INDEX `abm_device_organization_idx` ON `abm_device`;--> statement-breakpoint
DROP INDEX `account_recovery_status_idx` ON `account_recovery`;--> statement-breakpoint
DROP INDEX `account_session_context_last_used_idx` ON `account_session_context`;--> statement-breakpoint
DROP INDEX `android_device_organization_idx` ON `android_device`;--> statement-breakpoint
DROP INDEX `apple_business_manager_organization_unique` ON `apple_business_manager`;--> statement-breakpoint
DROP INDEX `attribute_definition_organization_sort_idx` ON `attribute_definition`;--> statement-breakpoint
DROP INDEX `autopilot_device_organization_idx` ON `autopilot_device`;--> statement-breakpoint
DROP INDEX `autopilot_profile_organization_idx` ON `autopilot_profile`;--> statement-breakpoint
DROP INDEX `dashboard_organization_id_idx` ON `dashboard`;--> statement-breakpoint
DROP INDEX `deployment_license_last_seen_idx` ON `deployment_license`;--> statement-breakpoint
DROP INDEX `device_organization_id_idx` ON `device`;--> statement-breakpoint
DROP INDEX `device_organization_enrolled_idx` ON `device`;--> statement-breakpoint
DROP INDEX `device_application_bundle_idx` ON `device_application`;--> statement-breakpoint
DROP INDEX `device_user_device_idx` ON `device_user`;--> statement-breakpoint
DROP INDEX `device_vpp_assignment_organization_idx` ON `device_vpp_assignment`;--> statement-breakpoint
DROP INDEX `device_vpp_assignment_asset_idx` ON `device_vpp_assignment`;--> statement-breakpoint
DROP INDEX `enrollment_answer_organization_serial_idx` ON `enrollment_answer`;--> statement-breakpoint
DROP INDEX `mcp_oauth_client_created_idx` ON `mcp_oauth_client`;--> statement-breakpoint
DROP INDEX `policy_deployment_policy_idx` ON `policy_deployment`;--> statement-breakpoint
DROP INDEX `scep_ca_trust_org_idx` ON `scep_ca_trust`;--> statement-breakpoint
DROP INDEX `scep_challenge_enrollment_idx` ON `scep_challenge`;--> statement-breakpoint
DROP INDEX `scep_issued_certificate_org_idx` ON `scep_issued_certificate`;--> statement-breakpoint
DROP INDEX `scim_token_organization_idx` ON `scim_token`;--> statement-breakpoint
DROP INDEX `stripe_event_organization_received_idx` ON `stripe_event`;--> statement-breakpoint
DROP INDEX `stripe_event_received_idx` ON `stripe_event`;--> statement-breakpoint
DROP INDEX `tenant_role_organization_idx` ON `tenant_role`;--> statement-breakpoint
DROP INDEX `user_group_organization_idx` ON `user_group`;--> statement-breakpoint
DROP INDEX `user_group_application_group_idx` ON `user_group_application`;--> statement-breakpoint
DROP INDEX `user_group_policy_group_idx` ON `user_group_policy`;--> statement-breakpoint
DROP INDEX `user_policy_user_idx` ON `user_policy`;--> statement-breakpoint
DROP INDEX `vpp_asset_organization_idx` ON `vpp_asset`;--> statement-breakpoint
DROP INDEX `vpp_token_organization_unique` ON `vpp_token`;--> statement-breakpoint
CREATE INDEX `account_audit_log_created_idx` ON `account_audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `android_pubsub_message_received_idx` ON `android_pubsub_message` (`received_at`);--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `device_dm_identifier_idx` ON `device` (`dm_identifier`);--> statement-breakpoint
CREATE INDEX `device_proto_serial_idx` ON `device` (`proto`,`serial`);--> statement-breakpoint
CREATE INDEX `device_command_device_created_idx` ON `device_command` (`device_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `email_outbox_status_created_idx` ON `email_outbox` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `enrollment_attempt_created_idx` ON `enrollment_attempt` (`created_at`);--> statement-breakpoint
CREATE INDEX `invitation_status_expires_idx` ON `invitation` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `webhook_delivery_created_idx` ON `webhook_delivery` (`created_at`);