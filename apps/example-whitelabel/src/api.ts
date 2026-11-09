import { ApnsService, ApnsServiceLive } from "@mattrax/apns";
import { Effect } from "effect";
import {
  type ApplicationRow,
  type CommandRow,
  type DeclarationRow,
  type DeviceRow,
  sha256hex,
} from "./db.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const pp = pattern.split("/");
  const ap = path.split("/");
  if (pp.length !== ap.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    const seg = pp[i]!;
    const actual = ap[i]!;
    if (seg.startsWith(":")) {
      params[seg.slice(1)] = decodeURIComponent(actual);
    } else if (seg !== actual) {
      return null;
    }
  }
  return params;
}

async function apnsPush(env: Env, device: DeviceRow): Promise<void> {
  if (!device.push_token || !device.push_magic || !device.apns_topic) return;
  if (!env.APNS_CERT || !env.APNS_KEY) return;
  const layer = ApnsServiceLive(env.APNS_CERT, env.APNS_KEY);
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const svc = yield* ApnsService;
        yield* svc.push({
          pushToken: device.push_token!,
          pushMagic: device.push_magic!,
          topic: device.apns_topic!,
        });
      }).pipe(Effect.catchTag("ApnsError", () => Effect.void)),
      layer,
    ),
  );
}

export async function handleApi(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  const path = new URL(request.url).pathname.slice("/api".length);
  const m = request.method;

  try {
    // GET /api/enroll-url
    if (m === "GET" && path === "/enroll-url") {
      return json({ url: `${env.ORIGIN}/mdm/apple/enroll` });
    }

    // GET /api/devices
    if (m === "GET" && path === "/devices") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM devices ORDER BY enrolled_at DESC",
      ).all<DeviceRow>();
      return json(results);
    }

    // GET /api/devices/:udid
    {
      const p = matchPath("/devices/:udid", path);
      if (p && m === "GET") {
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (!device) return json({ error: "Device not found" }, 404);
        const { results: commands } = await env.DB.prepare(
          "SELECT * FROM pending_commands WHERE device_udid = ? ORDER BY created_at DESC",
        )
          .bind(p.udid)
          .all<CommandRow>();
        const { results: declarations } = await env.DB.prepare(
          "SELECT * FROM device_declarations WHERE device_udid = ? ORDER BY created_at DESC",
        )
          .bind(p.udid)
          .all<DeclarationRow>();
        const { results: apps } = await env.DB.prepare(
          `SELECT a.*, da.install_method FROM applications a
           JOIN device_applications da ON a.id = da.application_id
           WHERE da.device_udid = ? ORDER BY da.created_at DESC`,
        )
          .bind(p.udid)
          .all();
        return json({ device, commands, declarations, apps });
      }
    }

    // POST /api/devices/:udid/sync
    {
      const p = matchPath("/devices/:udid/sync", path);
      if (p && m === "POST") {
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (!device) return json({ error: "Device not found" }, 404);
        if (!device.push_token || !device.push_magic || !device.apns_topic) {
          return json({ error: "Device has no push credentials yet" }, 422);
        }
        if (!env.APNS_CERT || !env.APNS_KEY) {
          return json({ error: "APNS_CERT and APNS_KEY environment variables are not set" }, 503);
        }
        const layer = ApnsServiceLive(env.APNS_CERT, env.APNS_KEY);
        await Effect.runPromise(
          Effect.provide(
            Effect.gen(function* () {
              const svc = yield* ApnsService;
              yield* svc.push({
                pushToken: device.push_token!,
                pushMagic: device.push_magic!,
                topic: device.apns_topic!,
              });
            }),
            layer,
          ),
        );
        return json({ ok: true });
      }
    }

    // POST /api/devices/:udid/unenroll
    {
      const p = matchPath("/devices/:udid/unenroll", path);
      if (p && m === "POST") {
        await env.DB.prepare("UPDATE devices SET unenrolled_at = unixepoch() WHERE udid = ?")
          .bind(p.udid)
          .run();
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (device) await apnsPush(env, device).catch(() => undefined);
        return json({ ok: true });
      }
    }

    // POST /api/devices/:udid/command
    {
      const p = matchPath("/devices/:udid/command", path);
      if (p && m === "POST") {
        const body = (await request.json()) as {
          requestType?: string;
          payload?: Record<string, unknown>;
        };
        if (!body.requestType) return json({ error: "requestType required" }, 400);
        const uuid = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO pending_commands (command_uuid, device_udid, request_type, payload) VALUES (?, ?, ?, ?)",
        )
          .bind(uuid, p.udid, body.requestType, JSON.stringify(body.payload ?? {}))
          .run();
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (device) await apnsPush(env, device).catch(() => undefined);
        return json({ commandUUID: uuid });
      }
    }

    // POST /api/devices/:udid/declaration
    {
      const p = matchPath("/devices/:udid/declaration", path);
      if (p && m === "POST") {
        const body = (await request.json()) as {
          identifier?: string;
          type?: string;
          payload?: Record<string, unknown>;
          category?: string;
        };
        if (!body.identifier || !body.type || !body.payload || !body.category) {
          return json({ error: "identifier, type, payload, category required" }, 400);
        }
        const valid = ["activations", "configurations", "assets", "management"];
        if (!valid.includes(body.category)) {
          return json({ error: `category must be one of: ${valid.join(", ")}` }, 400);
        }
        const serverToken = await sha256hex(JSON.stringify(body.payload));
        const fullDecl = {
          Type: body.type,
          Identifier: body.identifier,
          ServerToken: serverToken,
          Payload: body.payload,
        };
        await env.DB.prepare(
          `INSERT INTO device_declarations (identifier, device_udid, type, payload, server_token, category)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (device_udid, identifier) DO UPDATE SET
             type = excluded.type, payload = excluded.payload,
             server_token = excluded.server_token, category = excluded.category`,
        )
          .bind(
            body.identifier,
            p.udid,
            body.type,
            JSON.stringify(fullDecl),
            serverToken,
            body.category,
          )
          .run();
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (device) await apnsPush(env, device).catch(() => undefined);
        return json({ ok: true });
      }
    }

    // DELETE /api/devices/:udid/declaration/:identifier
    {
      const p = matchPath("/devices/:udid/declaration/:identifier", path);
      if (p && m === "DELETE") {
        await env.DB.prepare(
          "DELETE FROM device_declarations WHERE device_udid = ? AND identifier = ?",
        )
          .bind(p.udid, p.identifier)
          .run();
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (device) await apnsPush(env, device).catch(() => undefined);
        return json({ ok: true });
      }
    }

    // POST /api/devices/:udid/profile  (legacy profile via com.apple.configuration.legacy declaration)
    {
      const p = matchPath("/devices/:udid/profile", path);
      if (p && m === "POST") {
        const body = (await request.json()) as { identifier?: string; profileUrl?: string };
        if (!body.identifier || !body.profileUrl) {
          return json({ error: "identifier, profileUrl required" }, 400);
        }
        const declPayload = { ProfileURL: body.profileUrl };
        const serverToken = await sha256hex(JSON.stringify(declPayload));
        const fullDecl = {
          Type: "com.apple.configuration.legacy",
          Identifier: body.identifier,
          ServerToken: serverToken,
          Payload: declPayload,
        };
        await env.DB.prepare(
          `INSERT INTO device_declarations (identifier, device_udid, type, payload, server_token, category)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (device_udid, identifier) DO UPDATE SET
             type = excluded.type, payload = excluded.payload,
             server_token = excluded.server_token`,
        )
          .bind(
            body.identifier,
            p.udid,
            "com.apple.configuration.legacy",
            JSON.stringify(fullDecl),
            serverToken,
            "configurations",
          )
          .run();
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (device) await apnsPush(env, device).catch(() => undefined);
        return json({ ok: true });
      }
    }

    // POST /api/devices/:udid/application/:appId  (install via InstallApplication command)
    {
      const p = matchPath("/devices/:udid/application/:appId", path);
      if (p && m === "POST") {
        const app = await env.DB.prepare("SELECT * FROM applications WHERE id = ?")
          .bind(p.appId)
          .first<ApplicationRow>();
        if (!app) return json({ error: "Application not found" }, 404);
        const manifestUrl = `${env.ORIGIN}/api/applications/${app.id}/manifest`;
        const uuid = crypto.randomUUID();
        await env.DB.prepare(
          "INSERT INTO pending_commands (command_uuid, device_udid, request_type, payload) VALUES (?, ?, ?, ?)",
        )
          .bind(uuid, p.udid, "InstallApplication", JSON.stringify({ ManifestURL: manifestUrl }))
          .run();
        await env.DB.prepare(
          "INSERT INTO device_applications (device_udid, application_id, install_method) VALUES (?, ?, 'command') ON CONFLICT DO NOTHING",
        )
          .bind(p.udid, p.appId)
          .run();
        const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
          .bind(p.udid)
          .first<DeviceRow>();
        if (device) await apnsPush(env, device).catch(() => undefined);
        return json({ commandUUID: uuid });
      }
    }

    // DELETE /api/devices/:udid/application/:appId?method=command|declaration
    {
      const p = matchPath("/devices/:udid/application/:appId", path);
      if (p && m === "DELETE") {
        const app = await env.DB.prepare("SELECT * FROM applications WHERE id = ?")
          .bind(p.appId)
          .first<ApplicationRow>();
        if (!app) return json({ error: "Application not found" }, 404);
        const method = new URL(request.url).searchParams.get("method") ?? "command";
        if (method === "command") {
          const uuid = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO pending_commands (command_uuid, device_udid, request_type, payload) VALUES (?, ?, ?, ?)",
          )
            .bind(uuid, p.udid, "RemoveApplication", JSON.stringify({ Identifier: app.bundle_id }))
            .run();
          const device = await env.DB.prepare("SELECT * FROM devices WHERE udid = ?")
            .bind(p.udid)
            .first<DeviceRow>();
          if (device) await apnsPush(env, device).catch(() => undefined);
        }
        await env.DB.prepare(
          "DELETE FROM device_applications WHERE device_udid = ? AND application_id = ?",
        )
          .bind(p.udid, p.appId)
          .run();
        return json({ ok: true });
      }
    }

    // GET /api/applications
    if (m === "GET" && path === "/applications") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM applications ORDER BY created_at DESC",
      ).all<ApplicationRow>();
      return json(results);
    }

    // GET /api/applications/:id/manifest
    {
      const p = matchPath("/applications/:id/manifest", path);
      if (p && m === "GET") {
        const app = await env.DB.prepare("SELECT * FROM applications WHERE id = ?")
          .bind(p.id)
          .first<ApplicationRow>();
        if (!app) return new Response("Not found", { status: 404 });
        const pkgUrl = `${env.ORIGIN}/mdm/apple/assets/${encodeURIComponent(app.r2_key)}`;
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>items</key><array><dict>
    <key>assets</key><array><dict>
      <key>kind</key><string>software-package</string>
      <key>url</key><string>${pkgUrl}</string>
    </dict></array>
    <key>metadata</key><dict>
      <key>bundle-identifier</key><string>${app.bundle_id}</string>
      <key>bundle-version</key><string>${app.version}</string>
      <key>kind</key><string>software</string>
      <key>title</key><string>${app.name}</string>
    </dict>
  </dict></array>
</dict></plist>`;
        return new Response(xml, { headers: { "Content-Type": "application/xml" } });
      }
    }

    // POST /api/applications  (upload .pkg)
    if (m === "POST" && path === "/applications") {
      const form = await request.formData();
      const file = form.get("file") as File | null;
      const name = form.get("name") as string | null;
      const version = form.get("version") as string | null;
      const bundleId = form.get("bundleId") as string | null;
      if (!file || !name || !version || !bundleId) {
        return json({ error: "file, name, version, bundleId required" }, 400);
      }
      const id = crypto.randomUUID();
      const r2Key = `apps/${id}.pkg`;
      await env.APPS.put(r2Key, await file.arrayBuffer(), {
        httpMetadata: { contentType: "application/x-newton-compatible-pkg" },
      });
      await env.DB.prepare(
        "INSERT INTO applications (id, name, version, bundle_id, r2_key, file_size) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(id, name, version, bundleId, r2Key, file.size)
        .run();
      return json({ id });
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("API error:", err);
    return json({ error: String(err) }, 500);
  }
}
