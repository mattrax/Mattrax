import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, Show } from "solid-js";
import { ErrorText, Field, QueryError } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

export default function GeneralSettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const tenant = useQuery(() => ({
    queryKey: enterpriseKeys.tenant(params.tenantId),
    queryFn: () => enterprise.getTenant(params.tenantId),
  }));
  const [name, setName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [confirm, setConfirm] = createSignal("");
  const [deleteOpen, setDeleteOpen] = createSignal(false);

  createEffect(
    () => tenant.data,
    (data) => {
      if (data) {
        setName(data.name);
        setSlug(data.slug);
      }
    },
  );

  const save = useMutation(() => ({
    mutationFn: () => enterprise.patchTenant(params.tenantId, { name: name(), slug: slug() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));
  const del = useMutation(() => ({
    mutationFn: () => enterprise.deleteTenant(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
      navigate("/dashboard");
    },
  }));

  return (
    <div class="grid gap-6 xl:grid-cols-2">
      <QueryError class="xl:col-span-2" error={tenant} onRetry={() => void tenant.refetch()} />
      <Card>
        <CardHeader>
          <CardTitle>Tenant profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            class="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Display name">
              <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} required />
            </Field>
            <Field label="Slug" hint="Used in URLs and when generating identifiers.">
              <Input
                value={slug()}
                pattern="[a-z0-9-]+"
                onInput={(e) => setSlug(e.currentTarget.value.toLowerCase())}
                required
              />
            </Field>
            <ErrorText error={save.error} />
            <div class="flex items-center gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
              <Show when={tenant.data}>
                <span class="text-xs text-muted-foreground">
                  Created {new Date(tenant.data!.createdAt).toLocaleDateString()}
                </span>
              </Show>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tenant details</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <Row label="Tenant ID" value={params.tenantId ?? ""} mono />
          <Row label="Your role" value={tenant.data?.role ?? "…"} />
          <Row label="Devices" value="Managed from the Devices page" />
          <p class="pt-2 text-xs text-muted-foreground">
            Tenant resources (devices, groups, policies, members) are isolated from every other
            tenant.
          </p>
        </CardContent>
      </Card>

      <Card class="border-red-200 xl:col-span-2">
        <CardHeader>
          <CardTitle class="text-red-700">Danger zone</CardTitle>
        </CardHeader>
        <CardContent class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class="text-sm font-medium">Delete this tenant</p>
            <p class="text-sm text-muted-foreground">
              Devices are sent an unenroll request and all tenant data is permanently removed.
            </p>
            <ErrorText error={del.error} />
          </div>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete tenant
          </Button>
        </CardContent>
      </Card>

      <Dialog open={deleteOpen()} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {tenant.data?.name ?? "tenant"}?</DialogTitle>
            <DialogDescription>
              This cannot be undone. Type the tenant slug{" "}
              <span class="font-mono font-medium">{tenant.data?.slug}</span> to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirm()}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            placeholder={tenant.data?.slug}
          />
          <ErrorText error={del.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirm() !== tenant.data?.slug || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div class="flex items-center justify-between gap-4">
      <span class="text-muted-foreground">{props.label}</span>
      <span class={props.mono ? "truncate font-mono text-xs" : "text-right font-medium"}>
        {props.value}
      </span>
    </div>
  );
}
