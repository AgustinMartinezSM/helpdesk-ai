#!/bin/sh
# Repairs analytics-service's user_snapshots projection from
# organizations-service's memberships table (Sprint 10.7, ADR 0026).
#
# WHY THIS EXISTS AT ALL
#
# user_snapshots used to be keyed on user_id alone with a nullable tenant: a
# registration inserted the row untenanted and the first membership stamped an
# organization in. The first membership every account ever gets is the
# BOOTSTRAP one — organizations-service creates it while consuming that same
# registration event — so the holding pen claimed every row, no later
# membership could move it, and GET /analytics/summary reported approximately
# ZERO users for every real organization.
#
# Sprint 10.7 rekeyed the table on (user_id, organization_id) so a person is
# counted in every organization they belong to. That fixes the code and fixes
# nothing already in the database: no new membership.created.v1 fires for
# people who already joined, consumed events are gone, and there is no outbox
# (ADR 0006). Until this script runs, every existing environment still reports
# the wrong numbers.
#
# WHY THIS IS A SCRIPT AND NOT APPLICATION CODE
#
# Which organizations a person belongs to lives in helpdesk_organizations, and
# ADR 0003 forbids analytics-service from reading another service's database
# at runtime. Reading from one database and writing to another is a thing a
# migration or an operator may do and a service may not — the same argument
# backfill-bootstrap-memberships.sh and backfill-directory-memberships.sh
# already rest on. The alternative, a paginated snapshot endpoint plus a
# reconciler in the Sprint 9.16 shape, is a whole sprint and would give
# analytics-service a service credential and an HTTP layer it does not have.
#
# SAFETY
#
# Idempotent by construction: INSERT ... ON CONFLICT (user_id,
# organization_id) DO NOTHING, so a second run converges to the same state.
#
# DO NOTHING rather than DO UPDATE, which is the one place this deliberately
# differs from backfill-directory-memberships.sh: the only non-key column here
# is joined_at, nothing reads it, and rewriting it would churn every row on
# every run to no end.
#
# IT NEVER DELETES. Rows stamped with the bootstrap organization by the old
# write path (and by 20260731120000_scope_analytics_to_organization) survive
# this run and keep inflating the holding pen's headcount. They are REPORTED
# at the end with the statement to remove them, which is the stance Sprint
# 9.16 established for orphans: a projection row nothing explains is a human
# decision, not a script's.
#
# NOT THE SAME THING AS backfill-tenant-columns.sh. That script stamps the
# bootstrap literal onto every null tenant, which is exactly the defect
# described above. After the rekey there are no nulls left in user_snapshots
# for it to touch, so it is a structural no-op here — but do not reach for it.
#
# USAGE
#
#   docker exec -i helpdesk-ai-postgres sh < \
#     infrastructure/postgres/operations/backfill-user-snapshots.sh
#
# or, against a non-local database, set the two connection URLs first:
#
#   ORGANIZATIONS_DB_URL=... ANALYTICS_DB_URL=... sh backfill-user-snapshots.sh
#
# The defaults below use port 5432 because they are written for the docker
# exec path, where they resolve INSIDE the container. Running this from the
# host with the defaults would hit the machine's own PostgreSQL 16 on 5432,
# which compose.yaml, README.md and docs/architecture/local-development.md all
# say must not be touched. From the host, the project's database is on 5433 —
# pass both URLs explicitly with that port.
set -e

ORGANIZATIONS_DB_URL="${ORGANIZATIONS_DB_URL:-postgresql://organizations_service:helpdesk_local_only_organizations@localhost:5432/helpdesk_organizations}"
ANALYTICS_DB_URL="${ANALYTICS_DB_URL:-postgresql://analytics_service:helpdesk_local_only_analytics@localhost:5432/helpdesk_analytics}"

echo "Reading memberships from helpdesk_organizations..."

# One row per membership edge, which is exactly what the projection now
# stores. created_at travels as psql's timestamptz text form, which Postgres
# parses back losslessly on insert.
#
# EVERY membership, including suspended and deactivated ones: this projection
# has never distinguished them — nothing consumes membership.status-changed.v1
# — so filtering here would make the script disagree with the live write path
# and the counts would drift the moment somebody was suspended. Making the
# headcount active-only is a separate change, in both places at once.
MEMBERSHIPS=$(psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' -c "
  SELECT user_id, organization_id, created_at
  FROM memberships
  ORDER BY organization_id, user_id;
")

if [ -z "$MEMBERSHIPS" ]; then
  echo "No memberships found. Nothing to backfill."
  exit 0
fi

echo "$MEMBERSHIPS" | while IFS='|' read -r USER_ID ORG_ID CREATED_AT; do
  [ -z "$USER_ID" ] && continue
  psql "$ANALYTICS_DB_URL" -v ON_ERROR_STOP=1 --quiet -c "
    INSERT INTO user_snapshots (user_id, organization_id, joined_at)
    VALUES ('${USER_ID}', '${ORG_ID}', '${CREATED_AT}')
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  "
done

# Verification the operator should actually read. The two sides must agree
# per organization; a difference means this run did not finish.
echo "Done. Source counts per organization (helpdesk_organizations.memberships):"
psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT organization_id, count(*)
  FROM memberships
  GROUP BY organization_id
  ORDER BY count(*) DESC;
"

echo "Projection counts per organization (helpdesk_analytics.user_snapshots):"
psql "$ANALYTICS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT organization_id, count(*)
  FROM user_snapshots
  GROUP BY organization_id
  ORDER BY count(*) DESC;
"

# The rows this script cannot judge. Anything here was written by the old
# first-claimer path and is backed by no membership — almost always the
# bootstrap organization, holding every account the platform ever registered.
# Printed, never removed: see SAFETY.
echo ""
echo "Projection rows with no membership behind them (organization ids):"
echo "These are left in place. Removing one is a decision for a person."
psql "$ANALYTICS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT organization_id, count(*) AS unexplained_rows
  FROM user_snapshots
  GROUP BY organization_id
  ORDER BY count(*) DESC;
"
echo ""
echo "Compare the two listings above. To remove the rows of one organization"
echo "once you have decided they are stale, run against helpdesk_analytics:"
echo ""
echo "  DELETE FROM user_snapshots WHERE organization_id = '<organization-id>';"
