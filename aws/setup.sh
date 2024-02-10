# Commands to setup the EC2 instance
#!/bin/bash

# TODO: Replace `ec2-user`
# TODO: Run the Rust as non-root user
# TODO: SSH via Tailscale/ZeroTier

ssh-keygen -t ed25519 -a 200 -C "gh-actions"
cat .ssh/id_ed25519.pub >> .ssh/authorized_keys
cat .ssh/id_ed25519 # Copy and paste into GH secrets as `SSH_KEY`