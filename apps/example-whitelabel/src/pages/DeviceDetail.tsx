import { createResource, createSignal, For, Show } from "solid-js";
import { A, useParams } from "@solidjs/router";

interface Device {
  udid: string;
  serial_number: string | null;
  model: string | null;
  os_version: string | null;
  push_token: string | null;
  enrolled_at: number;
  unenrolled_at: number | null;
}

interface Command {
  command_uuid: string;
  request_type: string;
  payload: string;
  created_at: number;
  completed_at: number | null;
  status: string | null;
}

interface Declaration {
  identifier: string;
  type: string;
  payload: string;
  category: string;
  created_at: number;
}

interface App {
  id: string;
  name: string;
  version: string;
  bundle_id: string;
  install_method: string;
}

interface DeviceData {
  device: Device;
  commands: Command[];
  declarations: Declaration[];
  apps: App[];
}

interface UploadedApp {
  id: string;
  name: string;
  version: string;
  bundle_id: string;
}

async function fetchApps(): Promise<UploadedApp[]> {
  const res = await fetch("/api/applications");
  if (!res.ok) return [];
  return res.json() as Promise<UploadedApp[]>;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function StatusBadge(props: { status: string | null }) {
  if (!props.status) return <span class="badge badge-gray">Pending</span>;
  if (props.status === "Acknowledged") return <span class="badge badge-green">{props.status}</span>;
  if (props.status === "Error") return <span class="badge badge-red">{props.status}</span>;
  return <span class="badge badge-gray">{props.status}</span>;
}

export default function DeviceDetail() {
  const params = useParams<{ udid: string }>();
  const udid = decodeURIComponent(params.udid);

  const [data, { refetch }] = createResource(
    () => udid,
    async (id) => {
      const res = await fetch(`/api/devices/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<DeviceData>;
    },
  );
  const [allApps] = createResource(fetchApps);

  const [msg, setMsg] = createSignal<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = createSignal(false);

  // form state
  const [cmdType, setCmdType] = createSignal("DeviceInformation");
  const [cmdPayload, setCmdPayload] = createSignal("{}");
  const [declId, setDeclId] = createSignal("");
  const [declType, setDeclType] = createSignal("com.apple.configuration.restrictions");
  const [declPayload, setDeclPayload] = createSignal('{\n  "allowCamera": false\n}');
  const [declCat, setDeclCat] = createSignal("configurations");
  const [profId, setProfId] = createSignal("");
  const [profUrl, setProfUrl] = createSignal("");
  const [selectedApp, setSelectedApp] = createSignal("");

  async function act(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ text: successMsg, ok: true });
      await refetch();
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function apiPost(path: string, body?: unknown) {
    const res = await fetch(`/api${path}`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = (await res.json()) as { error: string };
      throw new Error(err.error ?? "Request failed");
    }
    return res.json();
  }

  async function apiDelete(path: string) {
    const res = await fetch(`/api${path}`, { method: "DELETE" });
    if (!res.ok) {
      const err = (await res.json()) as { error: string };
      throw new Error(err.error ?? "Request failed");
    }
  }

  return (
    <>
      <div class="breadcrumb">
        <A href="/">Devices</A> /{" "}
        <span class="mono" style="font-size:12px">
          {udid}
        </span>
      </div>

      <Show when={data.loading}>
        <p class="empty">Loading...</p>
      </Show>
      <Show when={data.error}>
        <p class="error">Error: {String(data.error)}</p>
      </Show>

      <Show when={data()}>
        {(d) => {
          const dev = d().device;
          return (
            <>
              {/* Device info */}
              <div class="card">
                <div class="section-header">
                  <h2>Device Info</h2>
                  <Show when={dev.unenrolled_at === null}>
                    <span class="badge badge-green">Enrolled</span>
                  </Show>
                  <Show when={dev.unenrolled_at !== null}>
                    <span class="badge badge-red">Unenrolled {fmtDate(dev.unenrolled_at!)}</span>
                  </Show>
                </div>
                <dl class="info-grid">
                  <div class="info-item">
                    <dt>UDID</dt>
                    <dd class="mono" style="font-size:11px">
                      {dev.udid}
                    </dd>
                  </div>
                  <div class="info-item">
                    <dt>Serial Number</dt>
                    <dd>{dev.serial_number ?? "—"}</dd>
                  </div>
                  <div class="info-item">
                    <dt>Model</dt>
                    <dd>{dev.model ?? "—"}</dd>
                  </div>
                  <div class="info-item">
                    <dt>OS Version</dt>
                    <dd>{dev.os_version ?? "—"}</dd>
                  </div>
                  <div class="info-item">
                    <dt>Enrolled At</dt>
                    <dd>{fmtDate(dev.enrolled_at)}</dd>
                  </div>
                  <div class="info-item">
                    <dt>Push Token</dt>
                    <dd>{dev.push_token ? "✓ Present" : "—"}</dd>
                  </div>
                </dl>
              </div>

              {/* Actions */}
              <div class="card">
                <h2>Actions</h2>
                <div class="actions-row">
                  <button
                    class="btn btn-secondary"
                    disabled={busy()}
                    onClick={() =>
                      act(
                        () => apiPost(`/devices/${encodeURIComponent(udid)}/sync`),
                        "APNS push sent",
                      )
                    }
                  >
                    Sync with APNS
                  </button>
                  <Show when={dev.unenrolled_at === null}>
                    <button
                      class="btn btn-danger"
                      disabled={busy()}
                      onClick={() => {
                        if (confirm("Mark this device as unenrolled server-side?")) {
                          void act(
                            () => apiPost(`/devices/${encodeURIComponent(udid)}/unenroll`),
                            "Device unenrolled",
                          );
                        }
                      }}
                    >
                      Unenroll (Server-Initiated)
                    </button>
                  </Show>
                </div>
                <Show when={msg()}>
                  <p class={msg()!.ok ? "success" : "error"}>{msg()!.text}</p>
                </Show>
              </div>

              {/* Push Legacy Command */}
              <div class="card">
                <h2>Push Legacy Command</h2>
                <div class="input-row">
                  <div class="col">
                    <label>Request Type</label>
                    <input
                      value={cmdType()}
                      onInput={(e) => setCmdType(e.currentTarget.value)}
                      placeholder="e.g. DeviceInformation"
                    />
                  </div>
                  <div class="col" style="flex:2">
                    <label>Payload (JSON)</label>
                    <input
                      value={cmdPayload()}
                      onInput={(e) => setCmdPayload(e.currentTarget.value)}
                      placeholder="{}"
                    />
                  </div>
                  <div>
                    <label style="visibility:hidden">.</label>
                    <button
                      class="btn btn-primary"
                      disabled={busy() || !cmdType()}
                      onClick={() =>
                        act(async () => {
                          let payload: Record<string, unknown>;
                          try {
                            payload = JSON.parse(cmdPayload() || "{}") as Record<string, unknown>;
                          } catch {
                            throw new Error("Invalid JSON payload");
                          }
                          await apiPost(`/devices/${encodeURIComponent(udid)}/command`, {
                            requestType: cmdType(),
                            payload,
                          });
                        }, "Command queued")
                      }
                    >
                      Send Command
                    </button>
                  </div>
                </div>
              </div>

              {/* Declarations (DDM) */}
              <div class="card">
                <div class="section-header">
                  <h2>DDM Declarations ({d().declarations.length})</h2>
                </div>

                <Show when={d().declarations.length > 0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Identifier</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>Added</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={d().declarations}>
                        {(decl) => (
                          <tr>
                            <td class="mono" style="font-size:11px">
                              {decl.identifier}
                            </td>
                            <td class="mono" style="font-size:11px">
                              {decl.type}
                            </td>
                            <td>
                              <span class="badge badge-gray">{decl.category}</span>
                            </td>
                            <td style="font-size:12px;color:#555">{fmtDate(decl.created_at)}</td>
                            <td>
                              <button
                                class="btn btn-danger btn-sm"
                                disabled={busy()}
                                onClick={() =>
                                  act(
                                    () =>
                                      apiDelete(
                                        `/devices/${encodeURIComponent(udid)}/declaration/${encodeURIComponent(decl.identifier)}`,
                                      ),
                                    "Declaration removed",
                                  )
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={d().declarations.length === 0}>
                  <p class="empty">No declarations pushed yet.</p>
                </Show>

                <details class="mt-12">
                  <summary>Push Declaration</summary>
                  <div class="form-section">
                    <div class="input-row">
                      <div class="col">
                        <label>Identifier</label>
                        <input
                          value={declId()}
                          onInput={(e) => setDeclId(e.currentTarget.value)}
                          placeholder="com.example.my-config"
                        />
                      </div>
                      <div class="col">
                        <label>Type</label>
                        <input
                          value={declType()}
                          onInput={(e) => setDeclType(e.currentTarget.value)}
                          placeholder="com.apple.configuration.restrictions"
                        />
                      </div>
                      <div class="col">
                        <label>Category</label>
                        <select
                          value={declCat()}
                          onChange={(e) => setDeclCat(e.currentTarget.value)}
                        >
                          <option value="activations">activations</option>
                          <option value="configurations">configurations</option>
                          <option value="assets">assets</option>
                          <option value="management">management</option>
                        </select>
                      </div>
                    </div>
                    <div class="mt-8">
                      <label>Payload (JSON)</label>
                      <textarea
                        value={declPayload()}
                        onInput={(e) => setDeclPayload(e.currentTarget.value)}
                      />
                    </div>
                    <div class="mt-8">
                      <button
                        class="btn btn-primary"
                        disabled={busy() || !declId() || !declType()}
                        onClick={() =>
                          act(async () => {
                            let payload: Record<string, unknown>;
                            try {
                              payload = JSON.parse(declPayload()) as Record<string, unknown>;
                            } catch {
                              throw new Error("Invalid JSON payload");
                            }
                            await apiPost(`/devices/${encodeURIComponent(udid)}/declaration`, {
                              identifier: declId(),
                              type: declType(),
                              payload,
                              category: declCat(),
                            });
                          }, "Declaration pushed")
                        }
                      >
                        Push Declaration
                      </button>
                    </div>
                  </div>
                </details>

                <details class="mt-8">
                  <summary>Push Legacy Profile (via declaration)</summary>
                  <div class="form-section">
                    <div class="input-row">
                      <div class="col">
                        <label>Declaration Identifier</label>
                        <input
                          value={profId()}
                          onInput={(e) => setProfId(e.currentTarget.value)}
                          placeholder="com.example.legacy-profile"
                        />
                      </div>
                      <div class="col" style="flex:2">
                        <label>Profile URL</label>
                        <input
                          value={profUrl()}
                          onInput={(e) => setProfUrl(e.currentTarget.value)}
                          placeholder="https://example.com/profile.mobileconfig"
                        />
                      </div>
                    </div>
                    <div class="mt-8">
                      <button
                        class="btn btn-primary"
                        disabled={busy() || !profId() || !profUrl()}
                        onClick={() =>
                          act(
                            () =>
                              apiPost(`/devices/${encodeURIComponent(udid)}/profile`, {
                                identifier: profId(),
                                profileUrl: profUrl(),
                              }),
                            "Legacy profile declaration pushed",
                          )
                        }
                      >
                        Push Legacy Profile
                      </button>
                    </div>
                  </div>
                </details>
              </div>

              {/* Applications */}
              <div class="card">
                <div class="section-header">
                  <h2>Applications ({d().apps.length})</h2>
                </div>

                <Show when={d().apps.length > 0}>
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Version</th>
                        <th>Bundle ID</th>
                        <th>Method</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={d().apps}>
                        {(app) => (
                          <tr>
                            <td>{app.name}</td>
                            <td>{app.version}</td>
                            <td class="mono" style="font-size:11px">
                              {app.bundle_id}
                            </td>
                            <td>
                              <span class="badge badge-gray">{app.install_method}</span>
                            </td>
                            <td style="display:flex;gap:6px">
                              <button
                                class="btn btn-danger btn-sm"
                                disabled={busy()}
                                onClick={() =>
                                  act(
                                    () =>
                                      fetch(
                                        `/api/devices/${encodeURIComponent(udid)}/application/${app.id}?method=command`,
                                        { method: "DELETE" },
                                      ).then(async (r) => {
                                        if (!r.ok) {
                                          const e = (await r.json()) as { error: string };
                                          throw new Error(e.error);
                                        }
                                      }),
                                    "Uninstall command queued",
                                  )
                                }
                              >
                                Uninstall (Command)
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={d().apps.length === 0}>
                  <p class="empty">No applications installed.</p>
                </Show>

                <details class="mt-12">
                  <summary>Install Application</summary>
                  <div class="form-section">
                    <Show when={(allApps() ?? []).length === 0}>
                      <p class="empty">
                        No applications uploaded yet. <A href="/applications">Upload one →</A>
                      </p>
                    </Show>
                    <Show when={(allApps() ?? []).length > 0}>
                      <div class="input-row">
                        <div class="col">
                          <label>Select Application</label>
                          <select
                            value={selectedApp()}
                            onChange={(e) => setSelectedApp(e.currentTarget.value)}
                          >
                            <option value="">— choose —</option>
                            <For each={allApps()}>
                              {(a) => (
                                <option value={a.id}>
                                  {a.name} {a.version} ({a.bundle_id})
                                </option>
                              )}
                            </For>
                          </select>
                        </div>
                        <div>
                          <label style="visibility:hidden">.</label>
                          <button
                            class="btn btn-primary"
                            disabled={busy() || !selectedApp()}
                            onClick={() =>
                              act(
                                () =>
                                  apiPost(
                                    `/devices/${encodeURIComponent(udid)}/application/${selectedApp()}`,
                                  ),
                                "InstallApplication command queued",
                              )
                            }
                          >
                            Install
                          </button>
                        </div>
                      </div>
                    </Show>
                  </div>
                </details>
              </div>

              {/* Commands history */}
              <div class="card">
                <h2>Command History ({d().commands.length})</h2>
                <Show when={d().commands.length === 0}>
                  <p class="empty">No commands yet.</p>
                </Show>
                <Show when={d().commands.length > 0}>
                  <table>
                    <thead>
                      <tr>
                        <th>UUID</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Queued</th>
                        <th>Completed</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={d().commands}>
                        {(cmd) => (
                          <tr>
                            <td class="mono" style="font-size:11px">
                              {cmd.command_uuid}
                            </td>
                            <td class="mono" style="font-size:12px">
                              {cmd.request_type}
                            </td>
                            <td>
                              <StatusBadge status={cmd.status} />
                            </td>
                            <td style="font-size:12px;color:#555">{fmtDate(cmd.created_at)}</td>
                            <td style="font-size:12px;color:#555">
                              {cmd.completed_at ? fmtDate(cmd.completed_at) : "—"}
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
              </div>
            </>
          );
        }}
      </Show>
    </>
  );
}
