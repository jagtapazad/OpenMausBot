---
name: fork-workflow
description: "Branch, commit, open and merge pull requests in the jagtapazad/OpenMausBot fork, and sync it with upstream. Use for any git or GitHub step in this repo."
---

# Fork workflow

Remotes: `origin` is `jagtapazad/OpenMausBot`, `upstream` is
`milind-soni/OpenMausBot` (read only). `gh repo set-default` points at the fork.

## A change

1. `git switch main && git pull --ff-only origin main`, then
   `git switch -c jaya/<short-topic>`. One concern per branch.
2. Before the first commit, read `AGENTS.md`, `CONTRIBUTING.md` and, for UI,
   `DESIGN.md`.
3. Run `pnpm lint`, `pnpm typecheck` and the tests for what changed
   (`pnpm vitest run <paths>`); run `pnpm test` before opening the PR.
   Locale changes also run `pnpm i18n:check`.
4. Verify server behavior against an isolated fixture
   (`docs/verification/README.md`, and `docs/verification/jaya.md` for Jaya),
   never against the person's live app or data.
5. Push with `git push -u origin HEAD`. The pre-push hook runs lint and the
   size and vocabulary guards; do not skip it to get a push through.
6. `gh pr create --repo jagtapazad/OpenMausBot --base main` with the sections of
   `.github/pull_request_template.md`. Under "How it was verified" record the
   upstream base commit (`git merge-base HEAD upstream/main`), the commands run
   and their results. UI pull requests carry `pnpm shots` screenshots in both
   skins.
7. Merge only after the checks pass, with `gh pr merge --squash --delete-branch`.

Never target `milind-soni/OpenMausBot` with `gh pr create`, `git push` or a
release command, and never pass `--repo milind-soni/OpenMausBot` to a command
that writes.

## Syncing upstream

1. `git fetch upstream && git switch -c sync/upstream-$(date +%Y-%m-%d) origin/main`.
2. `git merge upstream/main`. Resolve conflicts in Jaya's favour only inside
   Jaya's files; elsewhere take upstream and adapt Jaya to it.
3. `pnpm install && pnpm typecheck && pnpm test`, then open a pull request
   into the fork's `main` as above.

## Never

- Commit `.env`, keys, phone numbers, call transcripts or `~/.openmausbot` data.
- Edit `dist-server/`, `server/data-format-released.json` or the lockfile beyond
  a real dependency change.
- Re-enable the disabled release, publish or image workflows.
