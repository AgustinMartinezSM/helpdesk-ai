#!/bin/sh
# Verification for the organization_id backfill.
#
# The migration plan makes these checks part of the phase rather than an
# afterthought, because a backfill that half-worked looks exactly like one that
# worked until something reads the column.
#
# Four questions, one per section below:
#   1. Did any row disappear? (counts, compared against a snapshot)
#   2. Are any rows still untenanted?
#   3. Does any row point at an organization that does not exist?
#   4. Do a ticket and its comments and history agree on the organization?
#
# USAGE
#
#   Snapshot the counts BEFORE applying the migrations:
#     docker exec -i helpdesk-ai-postgres sh -s -- --snapshot < \
#       infrastructure/postgres/operations/verify-tenant-columns.sh
#
#   Verify AFTER:
#     docker exec -i helpdesk-ai-postgres sh < \
#       infrastructure/postgres/operations/verify-tenant-columns.sh
#
# The defaults use port 5432 because they resolve inside the container. From
# the host the project's PostgreSQL is on 5433 — the machine's own PostgreSQL
# 16 owns 5432 and must not be touched.
set -e

HOST="${PGHOST:-localhost}"
PORT="${PGPORT:-5432}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-/tmp/helpdesk-tenant-counts.txt}"
BOOTSTRAP_ID='00000000-0000-4000-8000-000000000001'

# service role : database : space-separated tables carrying organization_id
SCOPED="
tickets_service:helpdesk_tickets:tickets ticket_comments ticket_history
ai_service:helpdesk_ai:suggestions
analytics_service:helpdesk_analytics:ticket_snapshots
notification_service:helpdesk_notifications:ticket_refs notifications
audit_service:helpdesk_audit:audit_events
"

url_for() {
  echo "postgresql://$1:helpdesk_local_only_$2@${HOST}:${PORT}/helpdesk_$2"
}

count_all() {
  echo "$SCOPED" | while IFS=: read -r role db tables; do
    [ -z "$role" ] && continue
    suffix=$(echo "$db" | sed 's/^helpdesk_//')
    url=$(url_for "$role" "$suffix")
    for table in $tables; do
      n=$(psql "$url" -v ON_ERROR_STOP=1 --tuples-only --no-align \
        -c "SELECT count(*) FROM ${table};")
      echo "${db}.${table}=${n}"
    done
  done
}

if [ "$1" = "--snapshot" ]; then
  count_all > "$SNAPSHOT_FILE"
  echo "Snapshot written to ${SNAPSHOT_FILE}:"
  cat "$SNAPSHOT_FILE"
  exit 0
fi

FAILED=0

echo "1. Row counts before and after"
if [ -f "$SNAPSHOT_FILE" ]; then
  count_all > /tmp/helpdesk-tenant-counts-after.txt
  if diff "$SNAPSHOT_FILE" /tmp/helpdesk-tenant-counts-after.txt > /dev/null; then
    echo "   identical — no row was lost or created"
  else
    echo "   CHANGED:"
    diff "$SNAPSHOT_FILE" /tmp/helpdesk-tenant-counts-after.txt || true
    FAILED=1
  fi
else
  echo "   no snapshot at ${SNAPSHOT_FILE}; run with --snapshot before migrating"
  FAILED=1
fi

echo ""
echo "2. Rows still without an organization (expect 0 everywhere)"
echo "$SCOPED" | while IFS=: read -r role db tables; do
  [ -z "$role" ] && continue
  suffix=$(echo "$db" | sed 's/^helpdesk_//')
  url=$(url_for "$role" "$suffix")
  for table in $tables; do
    n=$(psql "$url" -v ON_ERROR_STOP=1 --tuples-only --no-align \
      -c "SELECT count(*) FROM ${table} WHERE organization_id IS NULL;")
    echo "   ${db}.${table}: ${n}"
    [ "$n" = "0" ] || echo "   ^^ UNPOPULATED ROWS"
  done
done

echo ""
echo "3. Organization ids that do not exist in helpdesk_organizations"
# Cross-database, so it is done by comparing sets rather than by a join: the
# services hold opaque ids on purpose (ADR 0003) and no foreign key can exist.
KNOWN=$(psql "$(url_for organizations_service organizations)" \
  -v ON_ERROR_STOP=1 --tuples-only --no-align -c "SELECT id FROM organizations;")
echo "$SCOPED" | while IFS=: read -r role db tables; do
  [ -z "$role" ] && continue
  suffix=$(echo "$db" | sed 's/^helpdesk_//')
  url=$(url_for "$role" "$suffix")
  for table in $tables; do
    psql "$url" -v ON_ERROR_STOP=1 --tuples-only --no-align \
      -c "SELECT DISTINCT organization_id FROM ${table} WHERE organization_id IS NOT NULL;" \
      | while read -r found; do
        [ -z "$found" ] && continue
        if ! echo "$KNOWN" | grep -qx "$found"; then
          echo "   ${db}.${table}: ${found} DOES NOT EXIST"
        fi
      done
  done
done
echo "   (nothing listed above means every id resolves)"

echo ""
echo "4. A ticket and its comments and history agree on the organization"
# One INNER JOIN per child table, deliberately. A LEFT JOIN reports a ticket
# with no comments as a disagreement, because NULL IS DISTINCT FROM <uuid> is
# true — and joining both children at once multiplies them into a cartesian
# product that inflates the counts. Both mistakes were made here first.
psql "$(url_for tickets_service tickets)" -v ON_ERROR_STOP=1 -c "
  SELECT 'comment' AS child, c.id AS row_id, t.id AS ticket,
         t.organization_id AS ticket_org, c.organization_id AS child_org
  FROM ticket_comments c
  JOIN tickets t ON t.id = c.ticket_id
  WHERE c.organization_id IS DISTINCT FROM t.organization_id
  UNION ALL
  SELECT 'history', h.id, t.id, t.organization_id, h.organization_id
  FROM ticket_history h
  JOIN tickets t ON t.id = h.ticket_id
  WHERE h.organization_id IS DISTINCT FROM t.organization_id;
"
echo "   (an empty result means every child agrees with its ticket)"

echo ""
echo "5. Everything landed on the bootstrap organization (expected in this phase)"
echo "$SCOPED" | while IFS=: read -r role db tables; do
  [ -z "$role" ] && continue
  suffix=$(echo "$db" | sed 's/^helpdesk_//')
  url=$(url_for "$role" "$suffix")
  for table in $tables; do
    n=$(psql "$url" -v ON_ERROR_STOP=1 --tuples-only --no-align \
      -c "SELECT count(*) FROM ${table} WHERE organization_id <> '${BOOTSTRAP_ID}';")
    [ "$n" = "0" ] || echo "   ${db}.${table}: ${n} row(s) on another organization"
  done
done
echo "   (nothing listed above means every row is on the bootstrap organization)"

exit $FAILED
