import { createResource, createSignal, For, Show } from "solid-js";
import { A } from "@solidjs/router";

interface Device {
  udid: string;
  serial_number: string | null;
  model: string | null;
  os_version: string | null;
  enrolled_at: number;
  unenrolled_at: number | null;
}

async function fetchDevices(): Promise<Device[]> {
  const res = await fetch("/api/devices");
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Device[]>;
}

async function fetchEnrollUrl(): Promise<string> {
  const res = await fetch("/api/enroll-url");
  if (!res.ok) return "";
  const data = (await res.json()) as { url: string };
  return data.url;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

export default function Devices() {
  const [devices, { refetch }] = createResource(fetchDevices);
  const [enrollUrl] = createResource(fetchEnrollUrl);
  const [copied, setCopied] = createSignal(false);

  async function copyEnrollUrl() {
    const url = enrollUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <h1>Devices</h1>

      <Show when={enrollUrl()}>
        <div class="enroll-box">
          <span class="mono">{enrollUrl()}</span>
          <button class="btn-secondary btn-sm" onClick={copyEnrollUrl}>
            {copied() ? "Copied!" : "Copy Enrollment URL"}
          </button>
          <a href={enrollUrl()} target="_blank" class="btn btn-primary btn-sm">
            Download Profile
          </a>
        </div>
      </Show>

      <div class="card">
        <div class="section-header">
          <h2>All Devices ({devices()?.length ?? 0})</h2>
          <button class="btn btn-secondary btn-sm" onClick={() => refetch()}>Refresh</button>
        </div>

        <Show when={devices.loading}>
          <p class="empty">Loading...</p>
        </Show>

        <Show when={devices.error}>
          <p class="error">Failed to load devices: {String(devices.error)}</p>
        </Show>

        <Show when={devices() && !devices.loading}>
          <Show when={devices()!.length === 0}>
            <p class="empty">No devices enrolled yet. Use the enrollment URL above to enroll your first device.</p>
          </Show>
          <Show when={devices()!.length > 0}>
            <table>
              <thead>
                <tr>
                  <th>UDID</th>
                  <th>Serial</th>
                  <th>Model</th>
                  <th>OS</th>
                  <th>Status</th>
                  <th>Enrolled</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <For each={devices()}>
                  {(d) => (
                    <tr>
                      <td class="mono" style="font-size:11px">{d.udid}</td>
                      <td>{d.serial_number ?? "—"}</td>
                      <td>{d.model ?? "—"}</td>
                      <td>{d.os_version ?? "—"}</td>
                      <td>
                        <Show when={d.unenrolled_at === null}>
                          <span class="badge badge-green">Enrolled</span>
                        </Show>
                        <Show when={d.unenrolled_at !== null}>
                          <span class="badge badge-red">Unenrolled</span>
                        </Show>
                      </td>
                      <td style="font-size:12px;color:#555">{fmtDate(d.enrolled_at)}</td>
                      <td>
                        <A href={`/devices/${encodeURIComponent(d.udid)}`} class="btn btn-secondary btn-sm">
                          Details →
                        </A>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </Show>
      </div>
    </>
  );
}
