# Copilot Instructions

When asked which database migrations to run:

1. Check the latest commits on the current branch for schema changes:
   - `git --no-pager log --oneline -n 15 -- backend/app.py backend/schema.sql`
   - `git --no-pager show --name-only --pretty=format:'%h %s' <commit>`
2. In this repository, migrations are handled in `backend/app.py` inside `init_schema()` via additive `ALTER TABLE` statements in `sop_migrations`.
3. If recent commits do not change `backend/schema.sql` or the `sop_migrations` list, report that no new migration scripts need to be run.
