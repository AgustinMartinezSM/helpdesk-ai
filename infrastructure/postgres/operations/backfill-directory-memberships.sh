#!/bin/sh
# Rebuilds users-service's directory_memberships projection from
# organizations-service's memberships table.
#
# WHY THIS IS A SCRIPT AND NOT APPLICATION CODE
#
# directory_memberships is a local projection of membership.created.v1 and
# membership.status-changed.v1, kept so the directory can be scoped without a
# synchronous call to organizations-service on every read (ADR 0014 forbids
# that dependency). Consumed events are gone and publishing is best-effort
# with no outbox (ADR 0006): if the broker is unavailable when a membership
# changes, the projection silently drifts and no replay can rebuild it. The
# truth lives in helpdesk_organizations, and ADR 0003 forbids users-service
# from reading another service's database at runtime.
#
# So the reconciliation is an operator action, run deliberately and by hand,
# rather than a runtime coupling that would outlive the migration. It reads
# from one database and writes to another, which is a thing a migration may
# do and a service may not.
#
# SAFETY
#
# Idempotent by construction: INSERT ... ON CONFLICT (organization_id,
# user_id) DO UPDATE, so a second run converges to the same state. Unlike
# backfill-bootstrap-memberships.sh this one DOES overwrite existing rows —
# the source database IS the truth and this script is the projection's
# rebuild path, so it must also repair the 'requester' placeholder rows the
# consumer writes when a created event was lost.
#
# It never deletes. A projection row whose source membership disappeared
# (only an organization deletion cascade can do that today) survives until
# handled by hand — that is what a difference in the counts printed at the
# end is telling you.
#
# USAGE
#
#   docker exec -i helpdesk-ai-postgres sh < \
#     infrastructure/postgres/operations/backfill-directory-memberships.sh
#
# or, against a non-local database, set the two connection URLs first:
#
#   ORGANIZATIONS_DB_URL=... USERS_DB_URL=... sh backfill-directory-memberships.sh
#
# The defaults below use port 5432 because they are written for the docker
# exec path, where they resolve INSIDE the container. Running this from the
# host with the defaults would hit the machine's own PostgreSQL 16 on 5432,
# which compose.yaml, README.md and docs/architecture/local-development.md all
# say must not be touched. From the host, the project's database is on 5433 —
# pass both URLs explicitly with that port.
set -e

ORGANIZATIONS_DB_URL="${ORGANIZATIONS_DB_URL:-postgresql://organizations_service:helpdesk_local_only_organizations@localhost:5432/helpdesk_organizations}"
USERS_DB_URL="${USERS_DB_URL:-postgresql://users_service:helpdesk_local_only_users@localhost:5432/helpdesk_users}"

echo "Reading memberships from helpdesk_organizations..."

# One row per membership edge. updated_at travels as psql's timestamptz text
# form, which Postgres parses back losslessly on insert.
MEMBERSHIPS=$(psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' -c "
  SELECT organization_id, user_id, role_template, status, updated_at
  FROM memberships
  ORDER BY organization_id, user_id;
")

if [ -z "$MEMBERSHIPS" ]; then
  echo "No memberships found. Nothing to backfill."
  exit 0
fi

echo "$MEMBERSHIPS" | while IFS='|' read -r ORG_ID USER_ID ROLE_TEMPLATE STATUS UPDATED_AT; do
  [ -z "$ORG_ID" ] && continue
  psql "$USERS_DB_URL" -v ON_ERROR_STOP=1 --quiet -c "
    INSERT INTO directory_memberships (
      organization_id, user_id, role_template, status, updated_at
    )
    VALUES (
      '${ORG_ID}', '${USER_ID}', '${ROLE_TEMPLATE}', '${STATUS}', '${UPDATED_AT}'
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role_template = EXCLUDED.role_template,
      status = EXCLUDED.status,
      updated_at = EXCLUDED.updated_at;
  "
done

# Verification the operator should actually read: the two tables must agree
# status by status. A source row missing from the projection means this run
# did not finish; a projection row missing from the source means something
# was deleted at the source and survives here (see SAFETY above).
echo "Done. Source counts by status (helpdesk_organizations.memberships):"
psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT status, count(*)
  FROM memberships
  GROUP BY status
  ORDER BY status;
"

echo "Projection counts by status (helpdesk_users.directory_memberships):"
psql "$USERS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT status, count(*)
  FROM directory_memberships
  GROUP BY status
  ORDER BY status;
"
