-- TODO
CREATE TABLE identity (
    -- TODO: Explain the ID
    id INT UNSIGNED PRIMARY KEY,
    cert VARBINARY(10000) NOT NULL,
    `key` VARBINARY(10000) NOT NULL,
    not_before TIMESTAMP NOT NULL,
    not_after TIMESTAMP NOT NULL
);

-- An account represents the login of an administrator.
-- These are used for accessing the Mattrax dashboard.
CREATE TABLE account (
    id CHAR(12) PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -- Each session represents a authentication token with access to a Mattrax account.
-- -- This could represent a browser or a CLI session.
-- CREATE TABLE session (
--     id CHAR(15) PRIMARY KEY,
--     account VARCHAR(255) NOT NULL,
--     created TIMESTAMP NOT NULL
-- );
--
-- TODO
CREATE TABLE tenant (
    id CHAR(12) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    -- Private key for signing the APNS certificate
    -- This is reused so should never change.
    apns_key VARBINARY(10000) NOT NULL,
    -- The currently active APNS certificate that was signed by Apple.
    -- This must be refreshed yearly.
    apns_cert VARBINARY(10000),
    -- The topic for the device to use with APNS.
    -- This is extracted from the `apns_cert`.
    apns_topic VARCHAR(255),
    -- Email of the Apple account used to create the APNs key
    -- This isn't required but is an important hint to the user.
    apns_email VARCHAR(255),
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TODO
CREATE TABLE tenant_member (
    tenant CHAR(12) NOT NULL,
    account CHAR(12) NOT NULL,
    PRIMARY KEY (tenant, account)
);

-- TODO
CREATE TABLE device (
    id CHAR(12) PRIMARY KEY,
    tenant CHAR(12) NOT NULL,
    identity CHAR(12) NOT NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TODO
CREATE TABLE policy (
    id CHAR(12) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(255),
    tenant CHAR(12) NOT NULL,
    version CHAR(12),
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TODO
CREATE TABLE policy_version (
    policy CHAR(12) NOT NULL,
    version CHAR(12) NOT NULL,
    data JSON NOT NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (policy, version)
);

-- TODO
CREATE TABLE `group` (
    id CHAR(12) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description VARCHAR(255),
    tenant CHAR(12) NOT NULL,
    created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- TODO
CREATE TABLE group_assignment (
    `group` CHAR(12) NOT NULL,
    -- TODO: Support 'user', 'group' variants
    type ENUM ('device') NOT NULL,
    id CHAR(12) NOT NULL,
    PRIMARY KEY (`group`, type, id)
);
