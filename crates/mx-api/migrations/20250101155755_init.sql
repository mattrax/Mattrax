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
    id INT UNSIGNED PRIMARY KEY, -- TODO: Change to nanoID style thing
    name VARCHAR(255) NOT NULL,
    -- TODO: Explain these
    apns_key VARBINARY(10000) NOT NULL,
    apns_cert VARBINARY(10000),
);

-- TODO: Whoe has access to tenant???
