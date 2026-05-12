import { A } from "@solidjs/router";
import { CheckCircle2, CircleAlert, Laptop, MonitorSmartphone, Smartphone, TabletSmartphone } from "lucide-solid";
import { For, Show, type JSX } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export function PageHeader(props: { title: string; description?: string; actions?: JSX.Element }) {
  return (
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-stone-950">{props.title}</h1>
        <Show when={props.description}><p class="mt-1 text-sm text-muted-foreground">{props.description}</p></Show>
      </div>
      <Show when={props.actions}><div class="flex items-center gap-2">{props.actions}</div></Show>
    </div>
  );
}

export function EmptyState(props: { title: string; description: string; action?: JSX.Element }) {
  return (
    <div class="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
      <div class="mb-4 rounded-full bg-stone-100 p-3 text-stone-500"><CircleAlert class="size-5" /></div>
      <h2 class="text-sm font-semibold text-stone-900">{props.title}</h2>
      <p class="mt-1 max-w-sm text-sm text-muted-foreground">{props.description}</p>
      <Show when={props.action}><div class="mt-5">{props.action}</div></Show>
    </div>
  );
}

export function DataTable<T>(props: { rows: T[] | undefined; columns: Array<{ header: string; class?: string; cell: (row: T) => JSX.Element }>; empty: JSX.Element }) {
  return (
    <Show when={(props.rows?.length ?? 0) > 0} fallback={props.empty}>
      <div class="overflow-hidden rounded-xl border bg-card">
        <table class="w-full text-sm">
          <thead class="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <tr><For each={props.columns}>{(col) => <th class={cn("px-4 py-3", col.class)}>{col.header}</th>}</For></tr>
          </thead>
          <tbody class="divide-y">
            <For each={props.rows}>{(row) => <tr class="hover:bg-muted/25"><For each={props.columns}>{(col) => <td class={cn("px-4 py-3 align-middle", col.class)}>{col.cell(row)}</td>}</For></tr>}</For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}

export function Field(props: { label: string; children: JSX.Element; hint?: string }) {
  return <label class="grid gap-1.5 text-sm"><span class="font-medium text-stone-800">{props.label}</span>{props.children}<Show when={props.hint}><span class="text-xs text-muted-foreground">{props.hint}</span></Show></label>;
}

export function ErrorText(props: { error: unknown }) {
  return <Show when={props.error}><p class="text-sm text-red-600">{props.error instanceof Error ? props.error.message : "Something went wrong"}</p></Show>;
}

export function LinkButton(props: { href: string; children: JSX.Element; variant?: "default" | "outline" | "ghost" | "secondary" }) {
  return <Button as={A} href={props.href} variant={props.variant ?? "default"}>{props.children}</Button>;
}

export function DeviceStatusBadge(props: { status: string }) {
  const variant = () => props.status === "enrolled" ? "default" : props.status === "unenrolling" || props.status === "enrolling" ? "secondary" : "outline";
  return <Badge variant={variant()}><CheckCircle2 class="size-3" />{props.status}</Badge>;
}

export function PlatformBadge(props: { proto: string }) {
  const icon = () => props.proto === "apple" ? <Laptop class="size-3" /> : props.proto === "win" ? <MonitorSmartphone class="size-3" /> : props.proto === "android" ? <Smartphone class="size-3" /> : <TabletSmartphone class="size-3" />;
  return <Badge variant="outline">{icon()}{props.proto}</Badge>;
}

export function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
