import { createResource, createSignal, For, Show } from "solid-js";

interface Application {
  id: string;
  name: string;
  version: string;
  bundle_id: string;
  r2_key: string;
  file_size: number;
  created_at: number;
}

async function fetchApps(): Promise<Application[]> {
  const res = await fetch("/api/applications");
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<Application[]>;
}

function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Applications() {
  const [apps, { refetch }] = createResource(fetchApps);
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<{ text: string; ok: boolean } | null>(null);

  const [file, setFile] = createSignal<File | null>(null);
  const [name, setName] = createSignal("");
  const [version, setVersion] = createSignal("");
  const [bundleId, setBundleId] = createSignal("");

  async function upload() {
    if (!file() || !name() || !version() || !bundleId()) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file()!);
      form.append("name", name());
      form.append("version", version());
      form.append("bundleId", bundleId());
      const res = await fetch("/api/applications", { method: "POST", body: form });
      if (!res.ok) {
        const e = (await res.json()) as { error: string };
        throw new Error(e.error);
      }
      setMsg({ text: "Application uploaded successfully.", ok: true });
      setFile(null);
      setName("");
      setVersion("");
      setBundleId("");
      await refetch();
    } catch (e) {
      setMsg({ text: String(e), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Applications</h1>

      <div class="card">
        <h2>Upload .pkg for macOS</h2>
        <div class="input-row" style="margin-bottom:10px">
          <div class="col" style="flex:2">
            <label>Package File (.pkg)</label>
            <input
              type="file"
              accept=".pkg"
              onChange={(e) => setFile(e.currentTarget.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div class="input-row">
          <div class="col">
            <label>Display Name</label>
            <input
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="My App"
            />
          </div>
          <div class="col">
            <label>Version</label>
            <input
              value={version()}
              onInput={(e) => setVersion(e.currentTarget.value)}
              placeholder="1.0.0"
            />
          </div>
          <div class="col">
            <label>Bundle ID</label>
            <input
              value={bundleId()}
              onInput={(e) => setBundleId(e.currentTarget.value)}
              placeholder="com.example.myapp"
            />
          </div>
          <div>
            <label style="visibility:hidden">.</label>
            <button
              class="btn btn-primary"
              disabled={busy() || !file() || !name() || !version() || !bundleId()}
              onClick={upload}
            >
              {busy() ? "Uploading…" : "Upload"}
            </button>
          </div>
        </div>
        <Show when={msg()}>
          <p class={msg()!.ok ? "success" : "error"} style="margin-top:8px">
            {msg()!.text}
          </p>
        </Show>
      </div>

      <div class="card">
        <div class="section-header">
          <h2>Uploaded Applications ({apps()?.length ?? 0})</h2>
          <button class="btn btn-secondary btn-sm" onClick={() => refetch()}>
            Refresh
          </button>
        </div>

        <Show when={apps.loading}>
          <p class="empty">Loading…</p>
        </Show>
        <Show when={apps.error}>
          <p class="error">Failed to load: {String(apps.error)}</p>
        </Show>

        <Show when={apps() && !apps.loading}>
          <Show when={apps()!.length === 0}>
            <p class="empty">No applications uploaded yet.</p>
          </Show>
          <Show when={apps()!.length > 0}>
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Version</th>
                  <th>Bundle ID</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th>Manifest URL</th>
                </tr>
              </thead>
              <tbody>
                <For each={apps()}>
                  {(app) => (
                    <tr>
                      <td style="font-weight:500">{app.name}</td>
                      <td>{app.version}</td>
                      <td class="mono" style="font-size:11px">
                        {app.bundle_id}
                      </td>
                      <td style="color:#555">{fmtSize(app.file_size)}</td>
                      <td style="font-size:12px;color:#555">{fmtDate(app.created_at)}</td>
                      <td>
                        <a
                          href={`/api/applications/${app.id}/manifest`}
                          target="_blank"
                          class="mono"
                          style="font-size:11px"
                        >
                          /api/applications/{app.id}/manifest
                        </a>
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
