import { useParams } from "@solidjs/router";
import { useMutation } from "@tanstack/solid-query";
import { createSignal, Show } from "solid-js";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Textarea } from "@mattrax/ui";
import { toast } from "~/components/toast";
import { ErrorText } from "./common";
import { enterprise } from "~/lib/enterprise";
import type { DeviceHandoverSecretKind } from "@mattrax/enterprise-domain/client";
import { downloadBlob } from "~/lib/download";
import { resolveTenantId } from "~/lib/tenant";

/**
 * The secret kinds named in the delete warning and the audit log. Kept in one
 * place so the dialog, the bulk bar and the docs cannot drift.
 */
export const DEVICE_HANDOVER_SECRET_LABELS: Record<DeviceHandoverSecretKind, string> = {
  filevault_recovery_key: "FileVault recovery key",
  activation_lock_bypass_code: "Activation Lock bypass code",
  recovery_lock_password: "Recovery Lock password",
  local_admin_password: "Local administrator password",
  bootstrap_token: "Bootstrap token",
  bitlocker_recovery_key: "BitLocker recovery keys",
};

export const deviceHandoverSecretLabel = (kind: DeviceHandoverSecretKind) =>
  DEVICE_HANDOVER_SECRET_LABELS[kind];

export const deviceHandoverSecretSummary = (kinds: ReadonlyArray<string>) =>
  kinds
    .map((kind) => DEVICE_HANDOVER_SECRET_LABELS[kind as DeviceHandoverSecretKind] ?? kind)
    .join(", ");

/**
 * Fetch the one-time sealed archive and hand it to the browser. The token is
 * bound to this archive and expires; the server refuses a second download.
 */
const downloadArchive = async (
  tenantId: string,
  archive: { readonly id: string; readonly filename: string; readonly downloadToken: string },
) => {
  const query = new URLSearchParams({ token: archive.downloadToken });
  const response = await enterprise.request(
    `/api/v1/tenants/${encodeURIComponent(tenantId)}/devices/handover/${encodeURIComponent(
      archive.id,
    )}/download?${query.toString()}`,
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      detail?: string;
    } | null;

    throw new Error(body?.message ?? body?.detail ?? `Download failed (${response.status})`);
  }

  downloadBlob(await response.blob(), archive.filename);
};

/**
 * Passphrase + reason prompt for a handover export. Used by the device page and
 * the bulk bar so both paths write the same audit record and one-time archive.
 */
export function DeviceHandoverDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Devices to export; one id for the detail page, many for a batch. */
  ids: ReadonlyArray<string>;
  /** Human-readable target for the confirmation copy. */
  target: string;
  onExported?: () => void;
}) {
  const params = useParams();
  const [passphrase, setPassphrase] = createSignal("");
  const [reason, setReason] = createSignal("");

  const reset = () => {
    // The passphrase only has to outlive the request. Drop it as soon as the
    // dialog closes or the archive is written.
    setPassphrase("");
    setReason("");
  };

  const create = useMutation(() => ({
    mutationFn: async () => {
      const tenantId = resolveTenantId(params.tenantId);

      if (!tenantId) throw new Error("Missing tenant");

      const archive = await enterprise.createDeviceHandover(tenantId, {
        ids: [...props.ids],
        passphrase: passphrase(),
        reason: reason(),
      });

      await downloadArchive(tenantId, archive);
      return archive;
    },
    onSuccess: (archive) => {
      reset();
      props.onOpenChange(false);
      props.onExported?.();

      toast.success("Device handover archive downloaded", {
        description:
          archive.deviceCount === 1
            ? "Store the file with the passphrase kept separately. The download works once."
            : `${archive.deviceCount} devices exported. Store the file with the passphrase kept separately. The download works once.`,
      });
    },
  }));

  const close = () => {
    reset();
    props.onOpenChange(false);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) reset();
        props.onOpenChange(open);
      }}
    >
      <DialogContent class="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hand over {props.target}</DialogTitle>
          <DialogDescription>
            Mattrax will export the serial, name, asset tag, notes and every escrowed secret for{" "}
            {props.target}. The archive is sealed with a passphrase you choose and can be downloaded
            once. The passphrase is never stored, so it cannot be recovered.
          </DialogDescription>
        </DialogHeader>
        <div class="space-y-3">
          <label class="block space-y-1.5">
            <span class="text-[12.5px] font-medium text-foreground">Passphrase</span>
            <Input
              type="password"
              autocomplete="new-password"
              value={passphrase()}
              onInput={(event) => setPassphrase(event.currentTarget.value)}
              placeholder="At least 12 characters"
            />
          </label>
          <label class="block space-y-1.5">
            <span class="text-[12.5px] font-medium text-foreground">Reason</span>
            <Textarea
              rows={2}
              value={reason()}
              onInput={(event) => setReason(event.currentTarget.value)}
              placeholder="For example: lease returned to IT, device replaced"
            />
          </label>
          <p class="text-[11.5px] leading-relaxed text-muted-foreground">
            The reason is recorded in the audit log. Secret values are not written to the audit log,
            the device list or any webhook.
          </p>
        </div>
        <ErrorText error={create.error} />
        <Show when={create.isPending}>
          <p class="text-[11.5px] text-muted-foreground">Sealing the archive…</p>
        </Show>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={passphrase().length < 12 || reason().trim().length < 5 || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Sealing…" : "Export and download"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
