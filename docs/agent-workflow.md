# Two-agent workflow (PR-based)

How the two agents — **claude** (Claude Code) and **codex** (Codex CLI) — work
on this repo since 2026-07-14. This replaces the `steps.md` step-claiming
protocol; that file is retained as a historical record of steps 000–048.

## Flow

1. **Backlog lives in GitHub issues.** One issue per unit of work. An agent
   picks up an issue (or a direct user request), never an unwritten task from
   another agent's notes.
2. **Each agent works on its own branch**: `codex/<topic>` or
   `claude/<topic>`, branched from `main`. Agents never commit to `main`
   directly and never push to another lane's branch. Branch isolation replaces
   the old `.steps.lock` / file-reservation machinery.
3. **Every change lands via a PR** with verification results (typecheck, tests,
   builds actually run) stated in the PR description.
4. **The user merges.** Agents do not merge their own PRs.

## Review tiering (carried over from the steps.md protocol, user-directed 2026-07-12)

- **Cheap/medium implementation work defaults to codex** (larger credit
  budget). Claude handles complex or high-risk work.
- **Frontier claude (Fable) reviews only high-failure-potential changes**:
  crypto (grants/leases), vote/resolution correctness, persistence
  integrity/privacy, admission security, and data-loss paths.
- **Codex-authored low-risk PRs self-verify** (tests + typecheck + build in the
  PR description); claude-authored PRs are cross-reviewed by codex.
- **No agent ever approves its own work** where a review is owed.

## Conventions

- Verification is mandatory: a PR states exactly what was run and the results.
  "Should pass" is not verification.
- Work discovered mid-PR becomes a new issue, not silent scope expansion.
- The full test suite (`pnpm -r typecheck && pnpm -r test`) runs before a PR is
  opened; e2e (`pnpm test:e2e`) when the change touches runtime client/server
  behavior.
- Director/policy decisions are recorded in
  [director-decisions.md](director-decisions.md), not in PR threads.

## Retired machinery

- `steps.md` — historical record only; do not claim steps or edit statuses.
- `.steps.lock/` protocol — obsolete (branch isolation supersedes it).
- `scripts/resume-work.sh` watchdog — retired; it exits immediately with a
  pointer here. Autonomous lane resumption, if wanted again, should be rebuilt
  around GitHub issues + PRs.
