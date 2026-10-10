# Contributing

All changes to this public repository, including documentation, reach `main` through a pull request reviewed and merged manually by a human maintainer. The human responsible for approving a branch is called **the operator**. Automated agents must not merge pull requests or enable auto-merge.

See [AGENTS.md](AGENTS.md) for source organization, local development, testing, accessibility and privacy requirements. Report vulnerabilities according to [SECURITY.md](SECURITY.md), without posting details publicly.

## Branches

- The default branch is `main`. Never commit directly to it or push to it directly.
- Use one feature branch per open theme of work. Use `codex/<theme>` for agent-created branches; external contributors may use branches in their forks.
- Continue related work on an existing open branch. Start a new branch from up-to-date `main` for a different theme; do not add unrelated work to whichever branch happens to be checked out.
- A merged branch's theme is closed. Later work on the same subject starts a new branch and pull request.

Start new work from a clean working tree after updating `main` with a fast-forward-only fetch integration:

```sh
git fetch origin
git switch main
git merge --ff-only origin/main
git switch -c codex/your-theme
```

If local `main` has diverged, stop and report it instead of resetting or rewriting it. Fast-forwarding the local tracking copy to an already merged `origin/main` is allowed; integrating feature work into `main` without a merge commit is not.

## Commits

- Commit verified work on the feature branch as it progresses, without asking the operator for permission for each commit.
- Use small logical commits. Each commit is one coherent step; its message explains what changed and why.
- Before a branch is published, you may amend, fix up, reorder or rebase its unpublished commits to form a clear sequence. Finish this cleanup before offering the branch for review; avoid work-in-progress and incidental typo-fix commits.
- Once commits are pushed, preserve their history. Address review feedback with focused follow-up commits; update the branch by merging `origin/main` when necessary. Do not rebase or amend pushed commits if doing so would require a force push.
- Never rewrite commits already on `main`.
- Review the staged diff, run the checks appropriate to the change, and preserve enabled commit signing. Do not bypass hooks with `--no-verify` or disable them. Fix a failed check before retrying.
- Report every commit outcome plainly, including failures. Keep unrelated local changes out of the commit.

## Pull requests and manual merging

When work is complete, state that the branch is ready and summarize its changes, validation and known limitations. Push only the feature branch (or a fork branch) when authorized. An agent must have explicit authorization to push or create a pull request; authorization to prepare changes alone is not authorization to publish them.

Open a pull request targeting `main`. Describe the final behavior, why it changed and how it was checked. Include screenshots for visible UI changes, using synthetic data. The operator reviews the actual diff and validation results. Any additional commits require review before merging; approval of one branch does not authorize another branch.

The operator manually merges the reviewed pull request using GitHub's **Create a merge commit** option. Do not use **Squash and merge**, **Rebase and merge**, auto-merge, or a local merge followed by a direct push to `main`. A GitHub merge commit preserves the branch as a unit that can be identified and reverted; it is the PR equivalent of `git merge --no-ff <branch>`.

After the operator confirms a successful merge, fetch the remote and fast-forward local `main` as shown above. Verify that the feature branch is contained in `origin/main`, then delete the local branch using `git branch -d <branch>`. Never use `git branch -D`. Keep the branch and report the problem if a merge, synchronization or safe deletion fails. Remote branch deletion is a separate action for the operator or GitHub's configured cleanup.

Never force-push, including with `--force-with-lease`. Report merge outcomes plainly; do not treat a closed, unmerged PR as a successful merge.

## Clone-local settings

These settings are not copied by `git clone`. Apply them once per checkout:

```sh
git config --local branch.main.mergeoptions --no-ff
git config --local pull.rebase merges
npm run setup:hooks
```

The merge option defaults local merges on `main` to merge commits; explicit `--ff-only` remains appropriate when synchronizing with `origin/main`. It does not authorize local integration of feature work or replace GitHub protections. `pull.rebase merges` preserves local merge structure during a rebase; never use it to rewrite `main` or already published feature commits. Prefer the explicit fetch and fast-forward procedure above for `main`.

Install Gitleaks on PATH before enabling the tracked hook. `.githooks/pre-commit` rejects every commit on `main`, including squash-merge attempts, and scans staged feature-branch changes with Gitleaks. It fails on findings or scanner errors. GitHub protection is still necessary: local hooks do not prevent pushes, are not enabled automatically in a fresh clone, and can be bypassed.

## GitHub settings for the operator

Configure these protections in GitHub; documenting them here does not enable them:

- Allow merge commits; disable squash merging, rebase merging and auto-merge.
- Protect `main` with a ruleset or branch protection requiring a pull request and human approval. Dismiss stale approvals when new commits are added; require resolution of review conversations.
- Apply protections to administrators and do not grant routine bypass permissions. Block direct updates outside the PR workflow, force pushes and branch deletion.
- Do not require linear history: it conflicts with preserving merge commits.
- Require automated status checks only after those checks are configured to run on pull requests. Local Gitleaks and test runs do not constitute GitHub status checks.

GitHub does not allow authors to approve their own pull requests. For a PR submitted using the operator's account, a required approving review must come from another human with the necessary permissions; an agent must not approve on the operator's behalf or bypass that requirement.

See GitHub's documentation on [protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) and [merge methods](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-pull-request-merges).
