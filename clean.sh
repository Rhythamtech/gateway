#!/bin/sh
# Removes this Compose project's containers, images, network, and data volume.
set -eu
cd "$(dirname "$0")"
exec docker compose -f docker-compose.yml -f docker-compose-cf.yml down --remove-orphans --rmi all --volumes
