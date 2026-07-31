#!/bin/sh
# Re-runnable backfill for the organization_id columns.
#
# The phase-4 migrations added each column and backfilled the rows that
# existed at that instant. Every row written between then and the phase-6
# consumer/write-path work carries NULL, because nothing set the column yet.
# The enforcement phase cannot add NOT NULL until those rows are filled, and
# re-running only the verification would pass on stale data and then the
# constraint would fail — which is why this script exists as an operator
# procedure rather than the migrations being replayed.
#
# It is idempotent by construction: every UPDATE is scoped to
# WHERE organization_id IS NULL, so a second run reports zero rows updated
# and a value a consumer set deliberately is never overwritten.
#
# SAFETY: assigning the bootstrap organization uniformly is only correct
# while it is the ONLY organization — with one tenant, every untenanted row
# can belong to nobody else. Once a second organization exists this blanket
# rule is wrong for audit_events (risk R4 in tenancy-migration-plan.md: the
# tenant there must be derived per event type), so the script refuses to run
# at all in that world rather than guessing.
#
# USAGE (inside the container, like the other operations scripts):
#
#   Dry run — report what would change, change nothing:
#     docker exec -i helpdesk-ai-postgres sh -s -- --dry-run < \
#       infrastructure/postgres/operations/backfill-tenant-columns.sh
#
#   Execute:
#     docker exec -i helpdesk-ai-postgres sh < \
#       infrastructure/postgres/operations/backfill-tenant-columns.sh
#
# The defaults use port 5432 because they resolve inside the container. From
# the host the project's PostgreSQL is on 5433 — the machine's own PostgreSQL
# 16 owns 5432 and must not be touched.
set -e

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
BOOTSTRAP_ID='00000000-0000-4000-8000-000000000001'

# service role : database : space-separated tables carrying organization_id.
# Keep in lockstep with verify-tenant-columns.sh — the verifier checks what
# this script fills, and a table present in one list but not the other is
# either unverified or unfilled.
SCOPED="
tickets_service:helpdesk_tickets:tickets ticket_comments ticket_history
ai_service:helpdesk_ai:suggestions
analytics_service:helpdesk_analytics:ticket_snapshots user_snapshots
notification_service:helpdesk_notifications:ticket_refs notifications
audit_service:helpdesk_audit:audit_events
"

url_for() {
  echo "postgresql://$1:helpdesk_local_only_$2@${HOST}:${PORT}/helpdesk_$2"
}

MODE=execute
[ "$1" = "--dry-run" ] && MODE=dry-run

ORG_COUNT=$(psql "$(url_for organizations_service organizations)" \
  -v ON_ERROR_STOP=1 --tuples-only --no-align -c "SELECT count(*) FROM organizations;")
if [ "$ORG_COUNT" != "1" ]; then
  echo "REFUSING: ${ORG_COUNT} organizations exist. This script assigns the"
  echo "bootstrap organization uniformly, which is only correct while it is"
  echo "the only one. See R4 in docs/architecture/tenancy-migration-plan.md."
  exit 1
fi

echo "Mode: ${MODE}"
echo ""
printf '%-45s %10s %10s %10s\n' "table" "rows" "tenanted" "null"

TOTAL_NULL=0
echo "$SCOPED" | while IFS=: read -r role db tables; do
  [ -z "$role" ] && continue
  suffix=$(echo "$db" | sed 's/^helpdesk_//')
  url=$(url_for "$role" "$suffix")
  for table in $tables; do
    counts=$(psql "$url" -v ON_ERROR_STOP=1 --tuples-only --no-align \
      -c "SELECT count(*) || ':' || count(organization_id) || ':' ||
          count(*) FILTER (WHERE organization_id IS NULL) FROM ${table};")
    rows=${counts%%:*}; rest=${counts#*:}; tenanted=${rest%%:*}; nulls=${rest#*:}
    printf '%-45s %10s %10s %10s\n' "${db}.${table}" "$rows" "$tenanted" "$nulls"
    if [ "$MODE" = "execute" ] && [ "$nulls" != "0" ]; then
      updated=$(psql "$url" -v ON_ERROR_STOP=1 --tuples-only --no-align \
        -c "WITH filled AS (
              UPDATE ${table} SET organization_id = '${BOOTSTRAP_ID}'
              WHERE organization_id IS NULL RETURNING 1
            ) SELECT count(*) FROM filled;")
      echo "   -> backfilled ${updated} row(s) to the bootstrap organization"
    fi
  done
done

echo ""
if [ "$MODE" = "dry-run" ]; then
  echo "Dry run: nothing was changed. The 'null' column is what an execute"
  echo "run would fill."
else
  echo "Done. Re-run with --dry-run to confirm the null column is now 0"
  echo "everywhere, then run verify-tenant-columns.sh."
fi
