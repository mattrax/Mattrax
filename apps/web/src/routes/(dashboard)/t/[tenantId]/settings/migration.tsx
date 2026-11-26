import { useLocation, useParams } from "@solidjs/router";
import { createEffect, createMemo, Loading } from "solid-js";
import type { ParentProps } from "solid-js";
import { LoadingState } from "@mattrax/ui";
import { isServer } from "@solidjs/web";
import { useNavigate } from "~/lib/navigation";
import SectionTabs from "~/components/settings/section-tabs";
import {
  activeMigrationTab,
  MIGRATION_TABS,
  migrationTabHref,
} from "~/components/settings/settings-tabs";
import { MIGRATION_MOVE_PERMISSIONS, useCan } from "~/lib/permissions";

export default function MigrationSettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { can, canAny } = useCan();
  const base = () => `/t/${params.tenantId}/settings/migration`;

  const canCohorts = () => can("devices.read");
  const canMove = () => canAny(MIGRATION_MOVE_PERMISSIONS);

  const visibleTabs = createMemo(() =>
    MIGRATION_TABS.filter((tab) => (tab.id === "" ? canCohorts() : canMove())),
  );

  // A role with the deployment tools but no device access lands on Cohorts
  // when it follows an old link; send it to the tab it can actually use.
  createEffect(
    () => ({ path: location.pathname, cohorts: canCohorts(), move: canMove() }),
    ({ path, cohorts, move }) => {
      if (isServer) return;

      if (path === base() && !cohorts && move)
        navigate(migrationTabHref(base(), "export"), { replace: true });
    },
  );

  return (
    <div class="flex flex-col">
      <SectionTabs
        label="Migration sections"
        active={activeMigrationTab(location.pathname, base())}
        tabs={visibleTabs().map((tab) => ({
          id: tab.id,
          label: tab.label,
          href: migrationTabHref(base(), tab.id),
        }))}
      />
      <div class="flex min-w-0 flex-col pt-5">
        <Loading
          fallback={
            <div class="flex min-h-40 items-center justify-center py-12">
              <LoadingState label="Loading migration section…" size={18} />
            </div>
          }
        >
          {props.children}
        </Loading>
      </div>
    </div>
  );
}
