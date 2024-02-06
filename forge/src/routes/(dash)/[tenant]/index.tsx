import Counter from "~/components/Counter";
import { trpc, untrackScopeFromSuspense } from "~/lib";

export default function Page() {
  const stats = trpc.tenant.stats.useQuery();
  const users = untrackScopeFromSuspense(() => stats.data?.users || 0);
  const devices = untrackScopeFromSuspense(() => stats.data?.devices || 0);
  const policies = untrackScopeFromSuspense(() => stats.data?.policies || 0);
  const apps = untrackScopeFromSuspense(() => stats.data?.apps || 0);
  const groups = untrackScopeFromSuspense(() => stats.data?.groups || 0);

  return (
    <div class="px-6 flex flex-col space-y-4">
      <dl class="mt-5 gap-5 flex">
        <StatItem title="Users" value={users()} />
        <StatItem title="Devices" value={devices()} />
        <StatItem title="Policies" value={policies()} />
        <StatItem title="Applications" value={apps()} />
        <StatItem title="Groups" value={groups()} />
      </dl>
      <div>
        <h1 class="text-muted-foreground opacity-70">
          Dashboard coming soon...
        </h1>
      </div>
    </div>
  );
}

function StatItem(props: { title: string; value: number }) {
  return (
    <div class="overflow-hidden rounded-lg bg-gray-100 dark:bg-brandDark px-4 py-5 shadow sm:p-6">
      <span class="truncate text-sm font-medium ">{props.title}</span>
      <Counter value={props.value} duration={1700}>
        {(count) => (
          <dd class="mt-1 text-3xl font-semibold tracking-tight">
            {count().toLocaleString()}
          </dd>
        )}
      </Counter>
    </div>
  );
}
