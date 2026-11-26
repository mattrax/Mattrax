import { useLocation, useParams } from "@solidjs/router";
import { Loading } from "solid-js";
import type { ParentProps } from "solid-js";
import { LoadingState } from "@mattrax/ui";
import SectionTabs from "~/components/settings/section-tabs";
import { useCan } from "~/lib/permissions";

const tabs = [
  { id: "", label: "Overview" },
  { id: "directory", label: "Directory sync" },
  { id: "domains", label: "Domains" },
];

export default function IdentitySettingsLayout(props: ParentProps) {
  const params = useParams();
  const location = useLocation();
  const { can } = useCan();
  const base = () => `/t/${params.tenantId}/settings/identity`;
  const visibleTabs = () => tabs.filter(() => can("identity.read"));

  const active = () => {
    const rest = location.pathname.slice(base().length).replace(/^\//, "");

    return rest.split("/")[0] ?? "";
  };

  return (
    <div class="flex flex-col">
      <SectionTabs
        label="Identity sections"
        active={active()}
        tabs={visibleTabs().map((tab) => ({
          id: tab.id,
          label: tab.label,
          href: tab.id ? `${base()}/${tab.id}` : base(),
        }))}
      />
      <div class="flex min-w-0 flex-col pt-5">
        <Loading
          fallback={
            <div class="flex min-h-40 items-center justify-center py-12">
              <LoadingState label="Loading identity section…" size={18} />
            </div>
          }
        >
          {props.children}
        </Loading>
      </div>
    </div>
  );
}
