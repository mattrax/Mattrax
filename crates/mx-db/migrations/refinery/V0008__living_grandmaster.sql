-- Custom SQL migration file, put you code below! --
-- Idk why but Drizzle aren't diffing `NOT NULL` correctly and adding it when it's not in the schema.
ALTER TABLE `devices` MODIFY COLUMN `enrolled_by` bigint unsigned;