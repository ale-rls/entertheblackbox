# Persistence boot configuration

Production persistence is enabled only when `DATABASE_URL` is set. Also set
`INSTALLATION_CLOSES_AT` to the installation's fixed public closing timestamp
(ISO 8601 with an offset). The server derives the participant-data deletion
deadline as exactly 90 days after that timestamp; changing it requires the
approved retention policy to be updated first.

At boot, the server applies `infra/migrations/001_persistence.sql`, registers
the repository scenario, marks any sessions left active by a prior crash as
ended with a recovery event, and invokes the participant-data deletion function.
It repeats deletion 24 hours after each completed run. Scheduling from completion
prevents overlapping cleanup queries when the database is slow. Cleanup success
and failure are emitted as structured `retention-cleanup-succeeded` and
`retention-cleanup-failed` log events; a failed run does not stop the show and is
retried on the next scheduled run or process boot. Shutdown cancels the pending
timer and waits for an in-flight cleanup before closing the database pool.

Persistence queue degradation and recovery are logged and written to
`health_events`. Shutdown flushes are bounded by
`PERSISTENCE_FLUSH_TIMEOUT_MS` (default: 5000 ms). See the retention check in
`docs/operations.md` for operator verification and escalation.

Without `DATABASE_URL`, development and test startup remains database-free.
