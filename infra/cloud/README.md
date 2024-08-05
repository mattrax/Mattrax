# Mattrax Cloud

This folder contains configured used to deploy `mattrax` for Mattrax Cloud.

Warning: You should not copy this for your own deployments!

Note: It is expected you initialise the database before deploying

## Environment

 - `DATABASE_URL` - MySQL url for the database
 - `MYSQL_DSN` - Used by Caddy for TLS certs. Should match `DATABASE_URL` but in the form `user:password@tcp(127.0.0.1:3306)/db`
 - `MDM_INTERNAL_SECRET` - Used to secure communications between JS and Rust
