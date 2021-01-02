-- Note: The lines to enable the Audit Log triggers are disabled due to being unsupported by the sqlc Postrges parser! You MUST enable them.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS hstore;

-- Note: This function will have collisions after huge amounts of entities are created. For now this is fine but in future will need to be fixed.
CREATE OR REPLACE FUNCTION short_uuid() RETURNS TEXT AS $$
BEGIN
return replace(replace(encode(gen_random_bytes(6), 'base64'), '/', '_'), '+', '-');
end;
$$ language 'plpgsql';

CREATE TABLE tenants (
	id TEXT PRIMARY KEY DEFAULT short_uuid(),
    display_name TEXT NOT NULL,
    primary_domain TEXT UNIQUE NOT NULL, -- TODO: REFERENCES
    email TEXT,
    phone TEXT,
    description TEXT,
    afw_enterprise_id TEXT
);

CREATE TABLE tenant_domains (
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    domain TEXT NOT NULL UNIQUE,
    linking_code TEXT NOT NULL DEFAULT CAST(FLOOR(random()*100000000) as int),
    verified BOOLEAN NOT NULL DEFAULT False,
    PRIMARY KEY (tenant_id, domain)
);

CREATE TABLE users (
    upn TEXT PRIMARY KEY,
    fullname TEXT NOT NULL,
    disabled BOOLEAN NOT NULL DEFAULT False,
    password TEXT,
    password_expiry TIMESTAMP WITH TIME ZONE,
    mfa_token TEXT,
    azuread_oid TEXT UNIQUE,
    tenant_id TEXT REFERENCES tenants(id),
    UNIQUE (fullname, tenant_id)
);

CREATE TYPE user_permission_level AS ENUM ('user', 'administrator');

CREATE TABLE tenant_users (
	user_upn TEXT REFERENCES users(upn) NOT NULL,
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    permission_level user_permission_level NOT NULL DEFAULT 'user',
    PRIMARY KEY (user_upn, tenant_id)
);

CREATE TYPE operation AS ENUM ('INSERT', 'UPDATE', 'DELETE');

CREATE TABLE event_log (
    event_id SERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    resource_id TEXT,
    tenant_id TEXT REFERENCES tenants(id),
    user_upn TEXT, -- TEMP: REFERENCES users(upn),
    time TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    operation operation NOT NULL,
    existing_value jsonb
);

CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS trigger AS $body$
DECLARE
    jsonNEW jsonb := to_jsonb(NEW);
    jsonOLD jsonb := to_jsonb(OLD);
BEGIN
    if (TG_OP = 'INSERT') then
        INSERT INTO event_log (table_name, operation, resource_id, tenant_id, user_upn, existing_value) VALUES(TG_TABLE_NAME, 'INSERT', COALESCE(jsonNEW->>'id', jsonNEW->>'upn'), jsonNEW->>'tenant_id', NULLIF(current_setting('mattrax.upn'), 'NULL'), to_jsonb(NEW));
        RETURN NEW;
   elsif (TG_OP = 'UPDATE') then
        INSERT INTO event_log (table_name, operation, resource_id, tenant_id, user_upn, existing_value)
            SELECT TG_TABLE_NAME, 'UPDATE', COALESCE(jsonOLD->>'id', jsonOLD->>'upn'), jsonOLD->>'tenant_id', NULLIF(current_setting('mattrax.upn'), 'NULL'), json_agg(json_build_object(o.key, o.value))
                FROM jsonb_each_text(jsonOLD) o
                JOIN jsonb_each_text(jsonNEW) n USING (key)
                WHERE n.value IS DISTINCT FROM o.value;
        RETURN NEW;
   elsif (TG_OP = 'DELETE') then
        INSERT INTO event_log (table_name, operation, resource_id, tenant_id, user_upn, existing_value) VALUES(TG_TABLE_NAME, 'DELETE', COALESCE(jsonOLD->>'id', jsonOLD->>'upn'), jsonOLD->>'tenant_id', NULLIF(current_setting('mattrax.upn'), 'NULL'), jsonOLD);
        RETURN OLD;
   end if;
END;
$body$
LANGUAGE plpgsql;

-- CREATE TRIGGER tenants_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
-- CREATE TRIGGER tenant_domains_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON tenant_domains FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
-- CREATE TRIGGER users_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TYPE management_protocol AS ENUM ('windows', 'agent', 'apple', 'android');
CREATE TYPE management_scope AS ENUM ('device', 'afw_profile', 'user');
CREATE TYPE device_state AS ENUM ('deploying', 'managed', 'user_unenrolled', 'disabled', 'missing');
CREATE TYPE device_ownership AS ENUM ('corporate', 'personal');


CREATE TABLE devices (
    id TEXT PRIMARY KEY DEFAULT short_uuid(),
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    protocol management_protocol NOT NULL,
    scope management_scope NOT NULL,
    state device_state NOT NULL,
    udid TEXT NOT NULL,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    serial_number TEXT,
    model_manufacturer TEXT,
    model TEXT,
    os_major TEXT,
    os_minor TEXT,
    owner TEXT REFERENCES users(upn),
    ownership device_ownership NOT NULL,
    azure_did TEXT UNIQUE,
    lastseen TIMESTAMP WITH TIME ZONE DEFAULT NOW(), -- TODO: NOT NULL,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE(protocol, udid)
);

-- CREATE TRIGGER devices_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON devices FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TABLE objects (
    id TEXT PRIMARY KEY DEFAULT short_uuid(),
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    filename TEXT,
    data bytea,
    UNIQUE (id, tenant_id)
);

-- TODO: Audit Table

-- TODO: Use | CREATE TYPE policy_type AS ENUM ('wifi', 'custom');

CREATE TABLE policies (
    id TEXT PRIMARY KEY DEFAULT short_uuid(),
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'custom',
    payload JSONB NOT NULL DEFAULT '{}',
    description TEXT,
    UNIQUE (tenant_id, name)
);

-- CREATE TRIGGER policies_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON policies FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TABLE applications (
    id TEXT PRIMARY KEY DEFAULT short_uuid(),
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    publisher TEXT,
    UNIQUE (tenant_id, name)
);

-- TODO: Audit Table

-- CREATE TYPE application_target_type AS ENUM ('MSI', 'Microsoft Business Store');
-- type application_target_type NOT NULL,
 -- protocol management_protocol NOT NULL,

CREATE TABLE application_target (
    app_id TEXT REFERENCES applications(id) NOT NULL,
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    msi_file TEXT REFERENCES objects(id),
    store_id TEXT
);

-- TODO: Audit Table

CREATE TABLE groups (
    id TEXT PRIMARY KEY DEFAULT short_uuid(),
    tenant_id TEXT REFERENCES tenants(id) NOT NULL,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

-- CREATE TRIGGER groups_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON groups FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TABLE group_devices (
    group_id TEXT REFERENCES groups(id) NOT NULL,
    device_id TEXT REFERENCES devices(id) NOT NULL,
    PRIMARY KEY (group_id, device_id)
);

CREATE TABLE group_policies (
    group_id TEXT REFERENCES groups(id) NOT NULL,
    policy_id TEXT REFERENCES policies(id) NOT NULL,
    PRIMARY KEY (group_id, policy_id)
);

CREATE TABLE certificates (
    id TEXT PRIMARY KEY,
    cert BYTEA,
    key BYTEA
);

-- CREATE TRIGGER certificates_audit_trigger AFTER INSERT OR UPDATE OR DELETE ON certificates FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TABLE android_for_work_enrollment_state (
    id TEXT PRIMARY KEY DEFAULT short_uuid(),
    name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);