export type DeviceRow = {
  udid: string;
  serial_number: string | null;
  model: string | null;
  os_version: string | null;
  push_token: string | null;
  push_magic: string | null;
  apns_topic: string | null;
  enrolled_at: number;
  unenrolled_at: number | null;
};

export type CommandRow = {
  command_uuid: string;
  device_udid: string;
  request_type: string;
  payload: string;
  created_at: number;
  completed_at: number | null;
  status: string | null;
};

export type DeclarationRow = {
  identifier: string;
  device_udid: string;
  type: string;
  payload: string;
  server_token: string;
  category: string;
  created_at: number;
};

export type ApplicationRow = {
  id: string;
  name: string;
  version: string;
  bundle_id: string;
  r2_key: string;
  file_size: number;
  created_at: number;
};

export async function sha256hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
