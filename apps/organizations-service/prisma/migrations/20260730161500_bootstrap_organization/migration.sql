-- Creates the bootstrap organization: the tenant every pre-migration row in
-- the platform will be assigned to when organization_id columns are added.
--
-- Why this lives in a migration rather than in a seed script: it has to exist
-- in a developer's database and in the CI database, and `prisma migrate
-- deploy` is the only provisioning step that runs in both. There is no seed
-- mechanism in this repository, and inventing one that CI does not run would
-- give the two environments different data.
--
-- The id is fixed and obviously synthetic on purpose. This row is the
-- recovery anchor for anything whose tenant cannot be re-derived, so every
-- environment naming it the same way is worth more than a random id, and a
-- reader who finds it in a foreign key should be able to tell at a glance
-- that it is the anchor and not an ordinary organization.
--
-- The migration plan requires this organization never to be deleted.

INSERT INTO "organizations" ("id", "slug", "name", "status", "created_at", "updated_at")
VALUES (
    '00000000-0000-4000-8000-000000000001',
    'bootstrap',
    'Bootstrap organization',
    'active',
    now(),
    now()
)
ON CONFLICT ("id") DO NOTHING;
