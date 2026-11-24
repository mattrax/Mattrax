import { useLocation, useParams } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { SectionTabs } from "~/components/settings/section-tabs";
import {
  activeMigrationTab,
  MIGRATION_TABS,
  migrationTabHref,
} from "~/components/settings/settings-tabs";

export default function MigrationSettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const base = () => `/t/${params.tenantId}/settings/migration`;

  return (
    <div class="flex flex-col">
      <SectionTabs
        label="Migration sections"
        active={activeMigrationTab(location.pathname, base())}
        tabs={MIGRATION_TABS.map((tab) => ({
          id: tab.id,
          label: tab.label,
          href: migrationTabHref(base(), tab.id),
        }))}
      />
      <div class="flex min-w-0 flex-col pt-5">{props.children}</div>
    </div>
  );
}
