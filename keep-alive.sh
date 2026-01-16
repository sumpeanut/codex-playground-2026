#!/bin/sh
# This script sets up the environment for VS Code Remote - Containers.

cp /root/ssh_files/* /root/.ssh/

chown root:root /root/.ssh/id_rsa
chown root:root /root/.ssh/id_rsa.pub
chown root:root /root/.ssh/known_hosts
chown root:root /root/.ssh/config
chmod 600 /root/.ssh/id_rsa
chmod 644 /root/.ssh/id_rsa.pub
chmod 644 /root/.ssh/known_hosts
chmod 644 /root/.ssh/config

eval "$(ssh-agent -s)"

# Keep the container running
while sleep 1000; do :; done
