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
TICKETS_PASSWORD="${HELPDESK_TICKETS_DB_PASSWORD:-helpdesk_local_only_tickets}"
USERS_PASSWORD="${HELPDESK_USERS_DB_PASSWORD:-helpdesk_local_only_users}"
AUDIT_PASSWORD="${HELPDESK_AUDIT_DB_PASSWORD:-helpdesk_local_only_audit}"
NOTIFICATIONS_PASSWORD="${HELPDESK_NOTIFICATIONS_DB_PASSWORD:-helpdesk_local_only_notifications}"
ANALYTICS_PASSWORD="${HELPDESK_ANALYTICS_DB_PASSWORD:-helpdesk_local_only_analytics}"
AI_PASSWORD="${HELPDESK_AI_DB_PASSWORD:-helpdesk_local_only_ai}"
ORGANIZATIONS_PASSWORD="${HELPDESK_ORGANIZATIONS_DB_PASSWORD:-helpdesk_local_only_organizations}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE auth_service LOGIN PASSWORD '${AUTH_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_auth OWNER auth_service;
  CREATE DATABASE helpdesk_auth_test OWNER auth_service;

  CREATE ROLE tickets_service LOGIN PASSWORD '${TICKETS_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_tickets OWNER tickets_service;
  CREATE DATABASE helpdesk_tickets_test OWNER tickets_service;

  CREATE ROLE users_service LOGIN PASSWORD '${USERS_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_users OWNER users_service;
  CREATE DATABASE helpdesk_users_test OWNER users_service;

  CREATE ROLE audit_service LOGIN PASSWORD '${AUDIT_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_audit OWNER audit_service;
  CREATE DATABASE helpdesk_audit_test OWNER audit_service;

  CREATE ROLE notification_service LOGIN PASSWORD '${NOTIFICATIONS_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_notifications OWNER notification_service;
  CREATE DATABASE helpdesk_notifications_test OWNER notification_service;

  CREATE ROLE analytics_service LOGIN PASSWORD '${ANALYTICS_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_analytics OWNER analytics_service;
  CREATE DATABASE helpdesk_analytics_test OWNER analytics_service;

  CREATE ROLE ai_service LOGIN PASSWORD '${AI_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_ai OWNER ai_service;
  CREATE DATABASE helpdesk_ai_test OWNER ai_service;

  CREATE ROLE organizations_service LOGIN PASSWORD '${ORGANIZATIONS_PASSWORD}' CREATEDB;
  CREATE DATABASE helpdesk_organizations OWNER organizations_service;
  CREATE DATABASE helpdesk_organizations_test OWNER organizations_service;
EOSQL
