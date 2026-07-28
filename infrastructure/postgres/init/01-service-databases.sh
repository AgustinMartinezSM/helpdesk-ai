#!/bin/sh
# Creates one role + logical database pair per service (ADR 0003).
#
# The official postgres image runs this only on FIRST initialization of an
# empty data volume. To re-provision locally: docker compose down, remove the
# helpdesk-ai_postgres-data volume, then docker compose up -d postgres.
#
# CREATEDB on service roles is LOCAL-ONLY: "prisma migrate dev" needs it to
# build its temporary shadow database. Production roles must not have it.
set -e

AUTH_PASSWORD="${HELPDESK_AUTH_DB_PASSWORD:-helpdesk_local_only_auth}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE auth_service LOGIN PASSWORD '${AUTH_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_auth OWNER auth_service;
  CREATE DATABASE helpdesk_auth_test OWNER auth_service;
EOSQL
