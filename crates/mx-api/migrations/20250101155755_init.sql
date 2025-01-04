-- TODO
-- TODO: Explain the ID
CREATE TABLE identity (
    id INT UNSIGNED PRIMARY KEY,
    cert VARBINARY(1000) NOT NULL,
    `key` VARBINARY(1000) NOT NULL,
    not_before TIMESTAMP NOT NULL,
    not_after TIMESTAMP NOT NULL
);
