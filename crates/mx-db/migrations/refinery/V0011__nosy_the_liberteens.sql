ALTER TABLE `passkey_challenges` DROP INDEX `passkey_challenges_challenge_unique`;
ALTER TABLE `passkey_challenges` ADD PRIMARY KEY(`challenge`);