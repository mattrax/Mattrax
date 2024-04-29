#!/bin/sh
#
# This script install the Mattrax server onto the current machine.

set -eu

MTTX_LANDING_URL="${MTTX_LANDING_URL:-https://mattrax.app}"
CHANNEL="${CHANNEL:-stable}"

# All the code is wrapped in a main function that gets called at the
# bottom of the file, so that a truncated partial download doesn't end
# up executing half a script.
main() {
    if [ "$(uname)" == "Darwin" ]; then
        echo "Mattrax does not support installation on macOS at this stage."
        exit 1
    # elif [ "$(expr substr $(uname -s) 1 5)" == "Linux" ]; then
    else
        echo "Mattrax does not support installation on '$(uname)' at this stage."
        exit 1
    fi

    if ! command -v curl &> /dev/null
    then
        echo "curl is required to install Mattrax. Please install it and try again."
        exit 1
    fi

    # TODO: Check running as root

    # TODO: Check for Systemd and if not found, error

    # # TODO: Check for existing installation (/usr/bin/mattrax)
    # if [ -f "/usr/bin/mattrax" ]; then
    #     echo "Mattrax is already installed. Please uninstall it before trying again."
    #     exit 1
    # fi

    # We download to a temp dir, incase the download fails, we don't end up with a partial file.
    curl -f -o /temp/mattrax "$MTTX_LANDING_URL/api/releases/mattrax/$MTTX_CHANNEL/$(uname -m)-unknown-linux"
    sudo mv /temp/mattrax /usr/bin/mattrax
    sudo chmod +x /usr/bin/mattrax

    # TODO: Run as non-root user
    sudo cat >/etc/systemd/system/mattrax.service <<EOL
[Unit]
ConditionPathExists=/var/lib/mattrax/config.json

[Service]
# WorkingDirectory=/home/ec2-user
ExecStart=mattrax serve
Restart=always
PrivateTmp=true
NoNewPrivileges=true

[Install]
Alias=mattrax
WantedBy=default.target
EOL

    sudo chmod 664 /etc/systemd/system/mattrax.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now mattrax
}

main