import Counter from "~/components/Counter";
import { trpc, untrackScopeFromSuspense } from "~/lib";

export default function Page() {
  const stats = trpc.tenant.stats.useQuery();

  const data = untrackScopeFromSuspense(() => ({ ...stats.data }));

  return (
    <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
      <h1 class="text-3xl font-bold mb-4">Dashboard</h1>
      <dl class="mt-5 gap-5 flex">
        <StatItem title="Users" value={data().users ?? 0} />
        <StatItem title="Devices" value={data().devices ?? 0} />
        <StatItem title="Policies" value={data().policies ?? 0} />
        <StatItem title="Applications" value={data().applications ?? 0} />
        <StatItem title="Groups" value={data().groups ?? 0} />
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
    <div class="rounded-lg bg-gray-100 dark:bg-brandDark px-4 py-5 shadow sm:p-6">
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
