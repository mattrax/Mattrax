import MigrationDetailPage, { route } from "../../migration/[migrationId]";

export { route };

/** Cohort detail stays inside the settings shell when entered from the rail. */
export default function SettingsMigrationDetailPage() {
  return <MigrationDetailPage embedded />;
}
