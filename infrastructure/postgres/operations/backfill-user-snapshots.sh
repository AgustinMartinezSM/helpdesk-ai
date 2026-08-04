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
# organization_id) DO UPDATE under the SAME last-writer-wins guard the live
# write path uses, so a second run converges to the same state and a run that
# races a live membership event cannot regress it.
#
# It used to be DO NOTHING, and Sprint 10.8 is why that changed. While the only
# non-key column was joined_at — which nothing reads — updating was pure churn.
# The projection now carries `status`, the headcount counts only active
# members, and this script is the only thing that can repair a status this
# database never heard about. joined_at is still never rewritten.
#
# ONE ASYMMETRY WORTH KNOWING: memberships.updated_at is bumped by ROLE changes
# too, so the watermark this script writes can sit slightly ahead of the last
# status transition. The consequence is that an in-flight status event older
# than it is refused — correctly, because the status this script just read is
# the newer truth.
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
# stores. Timestamps travel as psql's timestamptz text form, which Postgres
# parses back losslessly on insert.
#
# EVERY membership, whatever its status, and the status TRAVELS WITH IT. That
# is the change Sprint 10.8 made, and the previous version of this comment
# named it in advance: the projection could not distinguish a suspended member
# from an active one, so the script could not either without disagreeing with
# the live write path. Both moved together. Filtering to active here instead
# would be wrong in a way that is easy to miss — a suspension would never
# reach the projection, so reactivating somebody later would leave them
# uncounted until an unrelated event happened to arrive.
MEMBERSHIPS=$(psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' -c "
  SELECT user_id, organization_id, created_at, status, updated_at
  FROM memberships
  ORDER BY organization_id, user_id;
")

if [ -z "$MEMBERSHIPS" ]; then
  echo "No memberships found. Nothing to backfill."
  exit 0
fi

echo "$MEMBERSHIPS" | while IFS='|' read -r USER_ID ORG_ID CREATED_AT STATUS UPDATED_AT; do
  [ -z "$USER_ID" ] && continue
  psql "$ANALYTICS_DB_URL" -v ON_ERROR_STOP=1 --quiet -c "
    INSERT INTO user_snapshots
      (user_id, organization_id, joined_at, status, last_event_at)
    VALUES
      ('${USER_ID}', '${ORG_ID}', '${CREATED_AT}', '${STATUS}', '${UPDATED_AT}')
    ON CONFLICT (user_id, organization_id) DO UPDATE
      SET status = EXCLUDED.status,
          last_event_at = EXCLUDED.last_event_at
      WHERE user_snapshots.last_event_at <= EXCLUDED.last_event_at;
  "
done

# Verification the operator should actually read. The two sides must agree
# per organization; a difference means this run did not finish.
#
# BOTH totals are printed, and the ACTIVE one is the one that matters:
# GET /analytics/summary reports active members, so comparing "all edges"
# against the dashboard would look like a discrepancy in any organization that
# has ever suspended anybody.
echo "Done. Source counts per organization (helpdesk_organizations.memberships):"
psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT organization_id,
         count(*) AS all_memberships,
         count(*) FILTER (WHERE status = 'active') AS active_memberships
  FROM memberships
  GROUP BY organization_id
  ORDER BY count(*) DESC;
"

echo "Projection counts per organization (helpdesk_analytics.user_snapshots):"
psql "$ANALYTICS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT organization_id,
         count(*) AS all_rows,
         count(*) FILTER (WHERE status = 'active') AS counted_on_the_dashboard
  FROM user_snapshots
  GROUP BY organization_id
  ORDER BY count(*) DESC;
"

# The rows this script cannot judge. Anything here was written by the old
# first-claimer path and is backed by no membership — almost always the
# bootstrap organization, holding every account the platform ever registered.
# Printed, never removed: see SAFETY.
#
# THIS IS A REAL ANTI-JOIN, and Sprint 10.8 had to make it one. The query
# written in 10.7 grouped user_snapshots with NO filter at all, so it labelled
# EVERY row "unexplained" — including the ones this very run had just inserted
# from a live membership — directly above a suggested DELETE. An operator who
# trusted the label would have deleted a healthy organization's entire
# projection. Found by running the script, not by reading it.
#
# The two databases cannot be joined by the server, so the source keys are
# carried over as a VALUES list. That is why this reads the pairs out of the
# rows already fetched above rather than querying again: the answer must be
# the same set the loop just wrote, or the report describes a different run.
#
# THE LIST GOES THROUGH A FILE, NOT THROUGH `psql -c`, and that is not style.
# A single argv entry is capped at MAX_ARG_STRLEN — 128 KiB on Linux, verified
# in this very container — and each pair costs about 90 bytes, so `-c` starts
# failing with "Argument list too long" at roughly 1,400 memberships. With
# `set -e` that aborts the script BEFORE it prints the report it exists to
# print, so a backfill that fully succeeded would exit non-zero with no orphan
# listing: exactly the ambiguity the verification block was written to remove.
# `-f` reads a file and has no such limit.
ORPHAN_SQL="${TMPDIR:-/tmp}/user-snapshots-orphans.$$.sql"
trap 'rm -f "$ORPHAN_SQL"' EXIT

{
  printf 'WITH src (user_id, organization_id) AS (VALUES '
  echo "$MEMBERSHIPS" | awk -F'|' '$1 != "" {
    printf "%s(\047%s\047::uuid,\047%s\047::uuid)", sep, $1, $2; sep=","
  }'
  printf ')\n'
  printf 'SELECT snap.organization_id, count(*) AS unexplained_rows\n'
  printf 'FROM user_snapshots snap\n'
  printf 'LEFT JOIN src ON src.user_id = snap.user_id\n'
  printf ' AND src.organization_id = snap.organization_id\n'
  printf 'WHERE src.user_id IS NULL\n'
  printf 'GROUP BY snap.organization_id ORDER BY count(*) DESC;\n'

  printf '\\echo The first of those rows, named individually:\n'
  printf 'WITH src (user_id, organization_id) AS (VALUES '
  echo "$MEMBERSHIPS" | awk -F'|' '$1 != "" {
    printf "%s(\047%s\047::uuid,\047%s\047::uuid)", sep, $1, $2; sep=","
  }'
  printf ')\n'
  printf 'SELECT snap.organization_id, snap.user_id, snap.status\n'
  printf 'FROM user_snapshots snap\n'
  printf 'LEFT JOIN src ON src.user_id = snap.user_id\n'
  printf ' AND src.organization_id = snap.organization_id\n'
  printf 'WHERE src.user_id IS NULL\n'
  printf 'ORDER BY snap.organization_id, snap.user_id LIMIT 20;\n'
} > "$ORPHAN_SQL"

echo ""
echo "Projection rows with no membership behind them:"
echo "These are left in place. Removing one is a decision for a person."
psql "$ANALYTICS_DB_URL" -v ON_ERROR_STOP=1 -f "$ORPHAN_SQL"

echo ""
echo "An EMPTY listing above is the healthy result: every projection row is"
echo "backed by a membership. To remove one you have decided is stale, run"
echo "against helpdesk_analytics — by the PAIR, never by organization alone,"
echo "because an organization's other rows are the live ones:"
echo ""
echo "  DELETE FROM user_snapshots"
echo "   WHERE organization_id = '<organization-id>' AND user_id = '<user-id>';"
