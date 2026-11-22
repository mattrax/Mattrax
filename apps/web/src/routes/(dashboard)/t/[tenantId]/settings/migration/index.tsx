import MigrationPage, { route } from "../../migration/index";

export { route };

/** Migration inside the settings shell; the standalone route keeps deep links working. */
export default function SettingsMigrationPage() {
  return <MigrationPage embedded />;
}
