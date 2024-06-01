#!/bin/bash
# TODO: Remove this once the proper updater and CI is implemented.
# Deploy an update to Mattrax.

set -e


SERVER="44.223.248.193" 
TARGET_DIR=$(cargo metadata | jq -r .target_directory)

cargo zigbuild --release --target aarch64-unknown-linux-musl -p mattrax

scp "$TARGET_DIR/aarch64-unknown-linux-musl/release/mattrax" ec2-user@$SERVER:/home/ec2-user/mattrax

# sudo systemctl stop mattrax && sudo cp /home/ec2-user/mattrax /usr/bin/mattrax && sudo systemctl start mattrax

