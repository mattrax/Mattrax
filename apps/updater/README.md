# Updater

This server manages deploying updates to `mattrax`, `mattraxd` and `mttx`.

It is deployed to [Deno Deploy](https://deno.com/deploy) and uses [R2](https://www.cloudflare.com/developer-platform/r2/) to store binaries.

## Required environment variables

 - `SECRET` - Used for authenticating GH Actions
 - `R2_TOKEN` - Used for authenticating with R2