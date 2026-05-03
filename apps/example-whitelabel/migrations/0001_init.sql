CREATE TABLE IF NOT EXISTS devices (
  udid TEXT PRIMARY KEY,
  serial_number TEXT,
  model TEXT,
  os_version TEXT,
  push_token TEXT,
  push_magic TEXT,
  apns_topic TEXT,
  enrolled_at INTEGER NOT NULL DEFAULT (unixepoch()),
  unenrolled_at INTEGER
);

CREATE TABLE IF NOT EXISTS scep_ca (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cert_pem TEXT NOT NULL,
  private_key_jwk TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS pending_commands (
  command_uuid TEXT PRIMARY KEY,
  device_udid TEXT NOT NULL REFERENCES devices(udid),
  request_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS device_declarations (
  identifier TEXT NOT NULL,
  device_udid TEXT NOT NULL REFERENCES devices(udid),
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  server_token TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('activations', 'configurations', 'assets', 'management')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (device_udid, identifier)
);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS device_applications (
  device_udid TEXT NOT NULL REFERENCES devices(udid),
  application_id TEXT NOT NULL REFERENCES applications(id),
  install_method TEXT NOT NULL DEFAULT 'command',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (device_udid, application_id)
);
