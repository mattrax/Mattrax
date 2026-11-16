-- Per-tenant device serial uniqueness.
--
-- The old global unique index allowed the same serial in different
-- organizations while also preventing duplicates within one organization.
-- Data imported outside the application may already contain duplicate
-- (organization_id, serial) pairs. DROP INDEX and ADD UNIQUE INDEX are kept in
-- one ALTER statement so MySQL 8 applies it atomically: if duplicates exist the
-- statement fails and the existing index stays in place, rather than leaving
-- the table without serial uniqueness.
--
-- Pre-check (safe to run first; it should return no rows):
--   SELECT organization_id, serial, COUNT(*) FROM device
--   WHERE serial IS NOT NULL GROUP BY organization_id, serial HAVING COUNT(*) > 1;
-- Clear or re-serialise any duplicates, then re-run this migration.
ALTER TABLE `device`
	DROP INDEX `device_serial_unique`,
	ADD UNIQUE INDEX `device_organization_serial_unique` (`organization_id`,`serial`);
