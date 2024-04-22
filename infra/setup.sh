#!/bin/bash

# This script documents the commands required to set up Mattrax's backend server.
# This is not intended as a public guide for hosting Mattrax!!!!

# System
sudo yum upgrade
sudo hostnamectl set-hostname mattrax
sudo yum install -y htop

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale set --ssh
# You must manually remove port 22 from the AWS security group

# MySQL
sudo yum install -y mariadb105-server
sudo systemctl enable mariadb
sudo systemctl start mariadb
sudo mysql_secure_installation

# generate password for root user
openssl rand -hex 24

sudo mariadb
#   GRANT ALL ON *.* TO 'root'@'%' IDENTIFIED BY 'password' WITH GRANT OPTION;
#   FLUSH PRIVILEGES;
#   CREATE DATABASE mattrax;

# MySQL Backups
# TODO: https://github.com/lionelmann/mysql-backup/blob/master/mysql-backup.service
# mariabackup\
# --defaults-file=/home/dbadmin/my.cnf \
# --cloud-service=s3 --cloud-aws-region=<aws region> \
# --cloud-access-key-id=<aws access key id> --cloud-secret-access-key=<aws secret access key> \
# --cloud-bucket=<s3 bucket name> --cloud-object-key=<aws object key> \
# --backup-dir=/home/dba/s3backupdir --with-timestamp \
# --backup-image=- --incremental --incremental-base=history:last_backup \
# backup-to-image

# Mattrax
# TODO: Run as non-root user

# TODO: Wait for CI
# sudo ./mattrax init
# sudo systemctl restart mattrax

# Restart
sudo reboot