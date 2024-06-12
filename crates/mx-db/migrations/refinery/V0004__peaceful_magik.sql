ALTER TABLE `policy_deploy_status` ADD `conflicts` json;
ALTER TABLE `policy_deploy_status` DROP COLUMN `result`;