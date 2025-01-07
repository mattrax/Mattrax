-- TODO
-- TODO: Explain the ID
CREATE TABLE identity (
    id INT UNSIGNED PRIMARY KEY,
    cert VARBINARY(10000) NOT NULL,
    `key` VARBINARY(10000) NOT NULL,
    not_before TIMESTAMP NOT NULL,
    not_after TIMESTAMP NOT NULL
);

-- TODO
CREATE TABLE tenant (
    id CHAR(12) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    -- TODO: Explain these
    apns_key VARBINARY(10000) NOT NULL,
    apns_cert VARBINARY(10000),
    apns_topic VARCHAR(255)
);

-- TODO
CREATE TABLE tenant_member (
    tenant_id CHAR(12) NOT NULL,
    account_id CHAR(12) NOT NULL,
    PRIMARY KEY (tenant_id, account_id)
);
