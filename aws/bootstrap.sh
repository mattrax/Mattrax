#!/bin/bash
# Boostrap a new Mattrax cloud instance.

# TODO: Pull these from AWS secret manager
export DATABASE_URL=""
export TAILSCALE_AUTH_KEY=""

curl -fsSL https://tailscale.com/install.sh | sh

sudo tailscale up --authkey
sudo tailscale set --ssh

curl -fsSL https://mattrax.app/install.sh | CHANNEL=nightly sh
mattrax init "$DATABASE_URL"

sudo systemctl start mattrax