import { Schema } from "effect";
import { For, Show, createSignal } from "solid-js";
import { NativeSelect } from "@mattrax/ui";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { arrayBufferToBase64, selectFile } from "~/lib/upload-file";

/**
 * Certificate and mail profile editors.
 *
 * Certificate profiles are deliberately explicit about their limits: an
 * imported PKCS#12 is the certificate an enterprise CA issued out of band, and
 * the editor collects the leaf certificate so expiry and renewal are real
 * values rather than promises.
 */

type Config = Record<string, Schema.Json>;
const ConfigObjectSchema = Schema.Record(Schema.String, Schema.Json);
type ConfigObject = Schema.Schema.Type<typeof ConfigObjectSchema>;

export const CERTIFICATE_EDITOR_KINDS = {
  appleRoot: "mttx.apple.certificate.default",
  applePkcs: "mttx.apple.pkcs.default",
  applePfx: "mttx.apple.pfx.default",
  windowsRoot: "mttx.windows.certificate.default",
  windowsPkcs: "mttx.windows.pkcs.default",
  windowsPfx: "mttx.windows.pfx.default",
  androidRoot: "mttx.android.certificate.default",
  mail: "mttx.apple.mail.default",
} as const;

const decodeObject = Schema.decodeUnknownOption(ConfigObjectSchema);
const recordOf = (value: Schema.Json | undefined): ConfigObject => {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value))
    return {};

  const decoded = decodeObject(value);

  return decoded._tag === "Some" ? decoded.value : {};
};

const text = (value: Schema.Json | undefined): string =>
  Schema.is(Schema.String)(value) ? value : "";

const bool = (value: Schema.Json | undefined): boolean => value === true;

const pfxKinds = new Set<string>([
  CERTIFICATE_EDITOR_KINDS.applePkcs,
  CERTIFICATE_EDITOR_KINDS.applePfx,
  CERTIFICATE_EDITOR_KINDS.windowsPkcs,
  CERTIFICATE_EDITOR_KINDS.windowsPfx,
]);

const pkcsKinds = new Set<string>([
  CERTIFICATE_EDITOR_KINDS.applePkcs,
  CERTIFICATE_EDITOR_KINDS.windowsPkcs,
]);

const rootKinds = new Set<string>([
  CERTIFICATE_EDITOR_KINDS.appleRoot,
  CERTIFICATE_EDITOR_KINDS.windowsRoot,
  CERTIFICATE_EDITOR_KINDS.androidRoot,
]);

export function CertificateEditor(props: {
  config: Config;
  setKey: (key: string, value: Schema.Json) => void;
}) {
  const [error, setError] = createSignal<string | null>(null);

  const row = (kind: string) => recordOf(props.config[kind]);
  const update = (kind: string, patch: Record<string, Schema.Json>) =>
    props.setKey(kind, { ...row(kind), ...patch });
  const remove = (kind: string) => props.setKey(kind, null);

  const uploadPem = async (kind: string) => {
    setError(null);

    try {
      const pem = await (
        await selectFile(".pem,.crt,.cer,text/plain,application/pem,application/x-pem-file")
      ).text();

      update(kind, { pem });
    } catch (error_) {
      if (error_ instanceof Error && /abort/i.test(error_.name)) return;
      setError("Could not read that certificate.");
    }
  };

  const uploadPfx = async (kind: string) => {
    setError(null);

    try {
      const file = await selectFile(".pfx,.p12,application/x-pkcs12");
      const bytes = await file.arrayBuffer();

      update(kind, { pfx: arrayBufferToBase64(bytes), fileName: file.name });
    } catch (error_) {
      if (error_ instanceof Error && /abort/i.test(error_.name)) return;
      setError("Could not read that PFX file.");
    }
  };

  const uploadLeaf = async (kind: string) => {
    setError(null);

    try {
      const pem = await (
        await selectFile(".pem,.crt,.cer,text/plain,application/pem,application/x-pem-file")
      ).text();

      update(kind, { certificatePem: pem });
    } catch (error_) {
      if (error_ instanceof Error && /abort/i.test(error_.name)) return;
      setError("Could not read that certificate.");
    }
  };

  const status = (kind: string) => {
    const data = row(kind);

    if (text(data.materialSha256))
      return `${text(data.subject) || "Certificate"} · expires ${new Date(
        text(data.notAfter),
      ).toLocaleDateString()}`;

    if (rootKinds.has(kind) && text(data.pem)) return "Trusted root certificate configured";

    return pfxKinds.has(kind) ? "Add the PKCS#12 and its leaf certificate" : "Not configured";
  };

  const materialSection = (kind: string) => (
    <Show
      when={pfxKinds.has(kind)}
      fallback={
        <div class="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void uploadPem(kind)}>
            {text(row(kind).pem) ? "Replace PEM" : "Upload root certificate"}
          </Button>
          <Show when={text(row(kind).pem)}>
            <Button size="sm" variant="ghost" onClick={() => remove(kind)}>
              Remove
            </Button>
          </Show>
        </div>
      }
    >
      <div class="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{status(kind)}</Badge>
          <Button size="sm" variant="outline" onClick={() => void uploadPfx(kind)}>
            {text(row(kind).pfx) ? "PFX selected" : "Select PFX"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void uploadLeaf(kind)}>
            {text(row(kind).certificatePem) ? "Replace leaf certificate" : "Select leaf certificate"}
          </Button>
          <Show when={text(row(kind).materialSha256) && !text(row(kind).pfx)}>
            <Badge variant="outline" class="border-success/30 bg-success/10">
              Sealed at rest
            </Badge>
          </Show>
        </div>
        <p class="text-[11px] leading-relaxed text-muted-foreground">
          The PFX and password are sealed with the deployment secret and never returned by the
          API. The leaf certificate supplies the expiry Mattrax shows; it must match the PFX.
        </p>
        <Show when={text(row(kind).fileName)}>
          <p class="font-mono text-[11px] text-muted-foreground">{text(row(kind).fileName)}</p>
        </Show>
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="space-y-1 text-[12px]">
            <span class="font-medium text-foreground/90">PFX password</span>
            <Input
              type="password"
              autocomplete="new-password"
              placeholder={text(row(kind).materialSha256) ? "Unchanged" : "Password"}
              value={text(row(kind).password)}
              onInput={(event) => update(kind, { password: event.currentTarget.value })}
            />
          </label>
          <Show when={kind.startsWith("mttx.windows")}>
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">Windows key storage</span>
              <NativeSelect
                value={text(row(kind).keyLocation) || "tpm-preferred"}
                onChange={(event) => update(kind, { keyLocation: event.currentTarget.value })}
              >
                <option value="tpm-required">TPM required</option>
                <option value="tpm-preferred">TPM preferred, software fallback</option>
                <option value="software">Software</option>
                <option value="windows-hello">Windows Hello for Business</option>
              </NativeSelect>
            </label>
          </Show>
        </div>
        <Show
          when={
            kind.startsWith("mttx.windows") &&
            (text(row(kind).keyLocation) === "software" || !text(row(kind).keyLocation))
          }
        >
          <label class="flex items-center gap-2 text-[12px]">
            <input
              type="checkbox"
              class="size-4 accent-[var(--brand-solid)]"
              checked={bool(row(kind).exportable)}
              onChange={(event) => update(kind, { exportable: event.currentTarget.checked })}
            />
            <span>Allow the private key to be exported (software storage only)</span>
          </label>
        </Show>
        <Show when={pkcsKinds.has(kind)}>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">Certificate template</span>
              <Input
                placeholder="Mattrax-WiFi"
                value={text(row(kind).template)}
                onInput={(event) => update(kind, { template: event.currentTarget.value })}
              />
            </label>
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">Subject name format</span>
              <Input
                placeholder="CN={{device.name}}"
                value={text(row(kind).subjectNameFormat)}
                onInput={(event) => update(kind, { subjectNameFormat: event.currentTarget.value })}
              />
            </label>
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">Key usage</span>
              <Input
                placeholder="digitalSignature,keyEncipherment"
                value={text(row(kind).keyUsage)}
                onInput={(event) => update(kind, { keyUsage: event.currentTarget.value })}
              />
            </label>
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">Enterprise CA (name or FQDN)</span>
              <Input
                placeholder="Corp-Issuing-CA"
                value={text(recordOf(row(kind).ca).name)}
                onInput={(event) =>
                  update(kind, {
                    ca: { ...recordOf(row(kind).ca), name: event.currentTarget.value },
                  })
                }
              />
            </label>
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">CA / NDES URL (recorded)</span>
              <Input
                placeholder="https://ndes.example.com/certsrv/mscep/"
                value={text(recordOf(row(kind).ca).serverUrl)}
                onInput={(event) =>
                  update(kind, {
                    ca: { ...recordOf(row(kind).ca), serverUrl: event.currentTarget.value },
                  })
                }
              />
            </label>
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">Validity (days)</span>
              <Input
                type="number"
                min="1"
                max="3650"
                value={text(row(kind).validityDays)}
                onInput={(event) => {
                  const value = Number(event.currentTarget.value);

                  update(kind, value > 0 ? { validityDays: value } : {});
                }}
              />
            </label>
            <label class="space-y-1 text-[12px]">
              <span class="font-medium text-foreground/90">Renewal threshold (%)</span>
              <Input
                type="number"
                min="1"
                max="90"
                value={text(row(kind).renewalThresholdPercent)}
                onInput={(event) => {
                  const value = Number(event.currentTarget.value);

                  update(kind, value > 0 ? { renewalThresholdPercent: value } : {});
                }}
              />
            </label>
          </div>
          <p class="text-[11px] leading-relaxed text-muted-foreground">
            Mattrax does not contact the CA or NDES: issue the PKCS#12 with your enterprise
            connector, then upload it here. Renewal metadata is reported, not automatic.
          </p>
        </Show>
      </div>
    </Show>
  );

  const cards: Array<{ kind: string; title: string; detail: string }> = [
    {
      kind: CERTIFICATE_EDITOR_KINDS.appleRoot,
      title: "Apple trusted root",
      detail:
        "DDM credential asset and security.certificate declaration, or a pkcs1 profile on legacy devices.",
    },
    {
      kind: CERTIFICATE_EDITOR_KINDS.applePkcs,
      title: "Apple PKCS certificate",
      detail:
        "DDM identity asset and security.identity declaration, or a PKCS#12 profile on legacy devices.",
    },
    {
      kind: CERTIFICATE_EDITOR_KINDS.applePfx,
      title: "Apple imported PFX",
      detail: "A PKCS#12 identity for Wi-Fi, VPN or S/MIME on the device or user channel.",
    },
    {
      kind: CERTIFICATE_EDITOR_KINDS.windowsRoot,
      title: "Windows trusted root",
      detail: "RootCATrustedCertificates CSP on the next SyncML check-in.",
    },
    {
      kind: CERTIFICATE_EDITOR_KINDS.windowsPkcs,
      title: "Windows PKCS certificate",
      detail:
        "Issued PKCS#12 installed with ClientCertificateInstall/PFXCertInstall. Windows has no native NDES client in OMA-DM.",
    },
    {
      kind: CERTIFICATE_EDITOR_KINDS.windowsPfx,
      title: "Windows imported PFX",
      detail: "PKCS#12 installed into the device or user certificate store.",
    },
    {
      kind: CERTIFICATE_EDITOR_KINDS.androidRoot,
      title: "Android trusted root",
      detail:
        "User-installed CA through the policy's Open Network Configuration. Android has no client-certificate API.",
    },
  ];

  return (
    <div class="space-y-4">
      <p class="text-[12.5px] leading-relaxed text-muted-foreground">
        Certificates are delivered on the device channel unless the card is marked as user scope.
        A trusted root is the prerequisite for SCEP, PKCS and S/MIME trust.
      </p>
      <Show when={error()}>{(message) => <p class="text-[12px] text-destructive">{message()}</p>}</Show>
      <For each={cards}>
        {(card) => (
          <details class="rounded-lg border border-border" open={Boolean(props.config[card.kind])}>
            <summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
              <span class="min-w-0 flex-1">
                <span class="block text-[13px] font-medium text-foreground">{card.title}</span>
                <span class="block text-[11px] leading-relaxed text-muted-foreground">
                  {card.detail}
                </span>
              </span>
              <Show when={Boolean(props.config[card.kind])}>
                <Badge variant="outline">{status(card.kind)}</Badge>
              </Show>
            </summary>
            <div class="space-y-3 border-t border-border p-3">
              {materialSection(card.kind)}
              <Show when={pfxKinds.has(card.kind) || rootKinds.has(card.kind)}>
                <Show when={!rootKinds.has(card.kind)}>
                  <div class="flex justify-end">
                    <Button size="sm" variant="ghost" onClick={() => remove(card.kind)}>
                      Remove configuration
                    </Button>
                  </div>
                </Show>
              </Show>
            </div>
          </details>
        )}
      </For>
    </div>
  );
}

export function MailEditor(props: {
  config: Config;
  setKey: (key: string, value: Schema.Json) => void;
}) {
  const kind = CERTIFICATE_EDITOR_KINDS.mail;
  const row = (): ConfigObject => recordOf(props.config[kind]);
  const update = (patch: Record<string, Schema.Json>) =>
    props.setKey(kind, { ...row(), ...patch });
  const server = (key: "incoming" | "outgoing") => recordOf(row()[key]);
  const updateServer = (key: "incoming" | "outgoing", patch: Record<string, Schema.Json>) =>
    update({ [key]: { ...server(key), ...patch } });
  const smime = () => recordOf(row().smime);
  const direction = (key: "signing" | "encryption") => recordOf(smime()[key]);
  const updateDirection = (key: "signing" | "encryption", patch: Record<string, Schema.Json>) =>
    update({ smime: { ...smime(), [key]: { ...direction(key), ...patch } } });

  const serverFields = (key: "incoming" | "outgoing", label: string) => (
    <div class="space-y-2 rounded-lg border border-border bg-muted/10 p-3">
      <p class="text-[12px] font-medium text-foreground">{label}</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <Show when={key === "incoming"}>
          <label class="space-y-1 text-[12px]">
            <span>Protocol</span>
            <NativeSelect
              value={text(server(key).serverType) || "IMAP"}
              onChange={(event) =>
                updateServer(key, { serverType: event.currentTarget.value })
              }
            >
              <option value="IMAP">IMAP</option>
              <option value="POP">POP</option>
            </NativeSelect>
          </label>
        </Show>
        <label class="space-y-1 text-[12px]">
          <span>Host name</span>
          <Input
            placeholder={key === "incoming" ? "imap.example.com" : "smtp.example.com"}
            value={text(server(key).hostName)}
            onInput={(event) => updateServer(key, { hostName: event.currentTarget.value })}
          />
        </label>
        <label class="space-y-1 text-[12px]">
          <span>Authentication</span>
          <NativeSelect
            value={text(server(key).authenticationMethod) || "None"}
            onChange={(event) =>
              updateServer(key, { authenticationMethod: event.currentTarget.value })
            }
          >
            <option value="None">None (SSO or unauthenticated)</option>
            <option value="Password">Password</option>
            <option value="CRAMMD5">CRAM-MD5</option>
            <option value="NTLM">NTLM</option>
            <option value="HTTPMD5">HTTP-MD5</option>
          </NativeSelect>
        </label>
        <label class="space-y-1 text-[12px]">
          <span>Username</span>
          <Input
            value={text(server(key).username)}
            onInput={(event) => updateServer(key, { username: event.currentTarget.value })}
          />
        </label>
        <p class="text-[11px] leading-relaxed text-muted-foreground sm:col-span-2">
          Passwords are not stored in policy JSON. Use SSO/None, a custom mobileconfig, or an
          identity-based setup.
        </p>
      </div>
    </div>
  );

  return (
    <div class="space-y-4">
      <p class="text-[12.5px] leading-relaxed text-muted-foreground">
        An Apple Mail account with optional S/MIME signing and encryption. S/MIME references a PKCS
        or imported PFX identity from this policy. Mail passwords are never stored in policy JSON;
        use SSO/None, a custom mobileconfig, or an identity-based mail setup.
      </p>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="space-y-1 text-[12px]">
          <span class="font-medium text-foreground/90">Account name</span>
          <Input
            placeholder="Work Mail"
            value={text(row().visibleName)}
            onInput={(event) => update({ visibleName: event.currentTarget.value })}
          />
        </label>
        <label class="space-y-1 text-[12px]">
          <span class="font-medium text-foreground/90">Email address</span>
          <Input
            type="email"
            placeholder="person@example.com"
            value={text(row().emailAddress)}
            onInput={(event) => update({ emailAddress: event.currentTarget.value })}
          />
        </label>
      </div>
      {serverFields("incoming", "Incoming server")}
      {serverFields("outgoing", "Outgoing server")}
      <div class="space-y-3 rounded-lg border border-border p-3">
        <p class="text-[12px] font-medium text-foreground">S/MIME</p>
        <For
          each={[
            ["signing", "Sign messages"],
            ["encryption", "Encrypt and decrypt messages"],
          ] as const}
        >
          {([key, label]) => (
            <div class="space-y-2 rounded-lg border border-border/60 p-2.5">
              <label class="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  class="size-4 accent-[var(--brand-solid)]"
                  checked={bool(direction(key).enabled)}
                  onChange={(event) =>
                    updateDirection(key, { enabled: event.currentTarget.checked })
                  }
                />
                <span>{label}</span>
              </label>
              <label class="space-y-1 text-[12px]">
                <span>Identity certificate kind</span>
                <Input
                  placeholder="mttx.apple.pfx.default"
                  value={text(direction(key).certificateKind)}
                  onInput={(event) =>
                    updateDirection(key, { certificateKind: event.currentTarget.value })
                  }
                />
              </label>
              <Show when={key === "encryption"}>
                <label class="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    class="size-4 accent-[var(--brand-solid)]"
                    checked={bool(direction(key).encryptByDefault)}
                    onChange={(event) =>
                      updateDirection(key, { encryptByDefault: event.currentTarget.checked })
                    }
                  />
                  <span>Encrypt by default</span>
                </label>
              </Show>
              <div class="flex flex-wrap gap-3 text-[12px]">
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    class="size-4 accent-[var(--brand-solid)]"
                    checked={bool(direction(key).userOverrideable)}
                    onChange={(event) =>
                      updateDirection(key, { userOverrideable: event.currentTarget.checked })
                    }
                  />
                  <span>User can turn it off</span>
                </label>
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    class="size-4 accent-[var(--brand-solid)]"
                    checked={bool(direction(key).identityUserOverrideable)}
                    onChange={(event) =>
                      updateDirection(key, { identityUserOverrideable: event.currentTarget.checked })
                    }
                  />
                  <span>User can choose an identity</span>
                </label>
              </div>
            </div>
          )}
        </For>
      </div>
      <div class="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => props.setKey(kind, null)}>
          Remove mail profile
        </Button>
      </div>
      <Show when={text(row().visibleName) || text(row().emailAddress)}>
        <p class="text-[11px] leading-relaxed text-muted-foreground">
          Device-scoped mail accounts are supported on iPhone/iPadOS. macOS requires the user
          channel; configure scope in the JSON section if needed.
        </p>
      </Show>
    </div>
  );
}
