#!/usr/bin/env bash

set -e

INNGEST_CONFIG=".config/inngest/inngest.yaml"

# Try to store Inngest data in Postgres if it's available. Otherwise, use SQLite for local runs.
if [[ ! -f "${INNGEST_CONFIG}" ]]; then
    mkdir -p "$(dirname "${INNGEST_CONFIG}")"
    if [[ -n "${DATABASE_URL}" ]]; then
        printf 'postgres-uri: "%s"\n' "${DATABASE_URL}" > "${INNGEST_CONFIG}"
    else
        printf 'sqlite-dir: "/home/runner/workspace/.local/share/inngest"\n' > "${INNGEST_CONFIG}"
    fi
fi

exec inngest-cli dev -u http://localhost:5000/api/inngest --host 127.0.0.1 --port 3000 --config "${INNGEST_CONFIG}"
