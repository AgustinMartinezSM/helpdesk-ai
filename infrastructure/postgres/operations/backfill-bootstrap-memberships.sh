#!/bin/sh
# Gives every user who already existed a membership in the bootstrap
# organization.
#
# WHY THIS IS A SCRIPT AND NOT APPLICATION CODE
#
# organizations-service consumes user.registered.v1, so every user who
# registers from now on gets a membership automatically. Users who registered
# before the service existed cannot be reached that way: their rows live in
# helpdesk_auth, ADR 0003 forbids organizations-service from reading another
# service's database, and auth-service exposes no user-listing endpoint (a gap
# docs/architecture/data-ownership.md already records).
#
# So the reconciliation is an operator action, run deliberately and by hand,
# rather than a runtime coupling that would outlive the migration. It reads
# from one database and writes to another, which is a thing a migration may do
# and a service may not.
#
# It is also the recovery path for a lost event. Publishing is best-effort
# with no outbox (ADR 0006); if the broker is unavailable when someone
# registers, that user ends up with no membership and — unlike every
# projection in this platform — no replay can rebuild it. Re-running this
# script reconciles them.
#
# SAFETY
#
# Idempotent: ON CONFLICT DO NOTHING on (organization_id, user_id), so a
# second run changes nothing, and it never modifies an existing membership.
# It only inserts. Nothing here deletes or updates.
#
# The role template mirrors roleTemplateFromGlobalRoles() in
# apps/organizations-service/src/domain/membership.ts. If that mapping
# changes, change it here in the same commit — a user reconciled by hand and a
# user projected from an event must land on the same template.
#
# USAGE
#
#   docker exec -i helpdesk-ai-postgres sh < \
#     infrastructure/postgres/operations/backfill-bootstrap-memberships.sh
#
# or, against a non-local database, set the two connection URLs first:
#
#   AUTH_DB_URL=... ORGANIZATIONS_DB_URL=... sh backfill-bootstrap-memberships.sh
#
# The defaults below use port 5432 because they are written for the docker
# exec path, where they resolve INSIDE the container. Running this from the
# host with the defaults would hit the machine's own PostgreSQL 16 on 5432,
# which compose.yaml, README.md and docs/architecture/local-development.md all
# say must not be touched. From the host, the project's database is on 5433 —
# pass both URLs explicitly with that port.
set -e

AUTH_DB_URL="${AUTH_DB_URL:-postgresql://auth_service:helpdesk_local_only_auth@localhost:5432/helpdesk_auth}"
ORGANIZATIONS_DB_URL="${ORGANIZATIONS_DB_URL:-postgresql://organizations_service:helpdesk_local_only_organizations@localhost:5432/helpdesk_organizations}"
BOOTSTRAP_SLUG="${BOOTSTRAP_SLUG:-bootstrap}"

echo "Reading users from helpdesk_auth..."

# One row per user: id and the role template its global roles map onto. The
# CASE ladder is the SQL twin of roleTemplateFromGlobalRoles().
USERS=$(psql "$AUTH_DB_URL" -v ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' -c "
  SELECT
    id,
    CASE
      WHEN 'admin' = ANY(roles) THEN 'organization_admin'
      WHEN 'agent' = ANY(roles) THEN 'agent'
      ELSE 'requester'
    END
  FROM users
  ORDER BY created_at;
")

if [ -z "$USERS" ]; then
  echo "No users found. Nothing to backfill."
  exit 0
fi

echo "$USERS" | while IFS='|' read -r USER_ID ROLE_TEMPLATE; do
  [ -z "$USER_ID" ] && continue
  psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 --quiet -c "
    INSERT INTO memberships (
      id, organization_id, user_id, role_template, status, version,
      created_at, updated_at
    )
    SELECT
      gen_random_uuid(), o.id, '${USER_ID}', '${ROLE_TEMPLATE}', 'active', 1,
      now(), now()
    FROM organizations o
    WHERE o.slug = '${BOOTSTRAP_SLUG}'
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  "
done

echo "Done. Membership counts by role template:"
psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 -c "
  SELECT m.role_template, count(*)
  FROM memberships m
  JOIN organizations o ON o.id = m.organization_id
  WHERE o.slug = '${BOOTSTRAP_SLUG}'
  GROUP BY m.role_template
  ORDER BY m.role_template;
"

# Verification the operator should actually read: any user in helpdesk_auth
# with no membership is a backfill that did not finish.
echo "Users in helpdesk_auth without a bootstrap membership (expect 0):"
psql "$AUTH_DB_URL" -v ON_ERROR_STOP=1 --tuples-only -c "SELECT count(*) FROM users;" \
  | tr -d ' ' > /tmp/helpdesk_auth_user_count
psql "$ORGANIZATIONS_DB_URL" -v ON_ERROR_STOP=1 --tuples-only -c "
  SELECT count(*) FROM memberships m
  JOIN organizations o ON o.id = m.organization_id
  WHERE o.slug = '${BOOTSTRAP_SLUG}';
" | tr -d ' ' > /tmp/helpdesk_membership_count
echo "  users: $(cat /tmp/helpdesk_auth_user_count), memberships: $(cat /tmp/helpdesk_membership_count)"
