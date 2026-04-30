CREATE TABLE IF NOT EXISTS "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"udid" text NOT NULL,
	"serial_number" text,
	"model" text,
	"os_version" text,
	"supports_ddm" integer DEFAULT false NOT NULL,
	"push_token" text,
	"push_magic" text,
	"topic" text,
	"channel" text DEFAULT 'device' NOT NULL,
	"status" text DEFAULT 'enrolling' NOT NULL,
	"enrolled_at" integer NOT NULL,
	"last_seen_at" integer NOT NULL,
	"identity_cert_pem" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "devices_udid_unique" ON "devices" ("udid");

CREATE TABLE IF NOT EXISTS "commands" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"request_type" text NOT NULL,
	"payload" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_detail" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" integer NOT NULL,
	"sent_at" integer,
	FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON UPDATE no action ON DELETE no action
);

CREATE TABLE IF NOT EXISTS "declarations" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" text NOT NULL,
	"server_token" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "device_declarations" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"device_id" text NOT NULL,
	"declaration_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"detail" text,
	"server_token" text NOT NULL,
	FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON UPDATE no action ON DELETE no action,
	FOREIGN KEY ("declaration_id") REFERENCES "declarations"("id") ON UPDATE no action ON DELETE no action
);

CREATE TABLE IF NOT EXISTS "scep_ca" (
	"id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	"cert_pem" text NOT NULL,
	"private_key_jwk" text NOT NULL,
	"created_at" integer NOT NULL
);
