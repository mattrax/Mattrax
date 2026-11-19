ALTER TABLE `audit_log` ADD `principal_id` varchar(255);--> statement-breakpoint
-- Align backfilled categories with `defaultAuditCategory`: device/MDM traffic
-- and enrollment answers are `mdm`; Android tenant connection events, script
-- results and other background work are `system`.
UPDATE `audit_log` SET `category` = CASE WHEN `action` LIKE 'device.%' OR `action` LIKE 'mdm.%' OR `action` LIKE 'enrollment.%' THEN 'mdm' ELSE 'system' END WHERE `actor_type` = 'system';
