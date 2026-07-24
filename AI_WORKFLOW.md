# AI Workflow

Single source of truth for how any AI coding agent (Claude Code, Codex, GLM, Kimi, Antigravity, or any other) tracks work on this project via AI Control Centre. Read this before starting substantial work and again before ending a session.

## Source of truth

- HANDOFF.md is the project's durable working memory and cross-model handoff. Treat it and the current repository state as authoritative over prior chat context or a compaction summary.
- Preserve settled decisions (see DECISIONS.md) unless the user explicitly changes them or newer verified evidence contradicts them.
- When HANDOFF.md, repository files, screenshots, tool output, or chat context conflict, identify the conflict and follow the most recent verified source.

## Session start recording

- At the beginning of substantial work, record a session-start event through this repository's AI Control Centre activity helper.
- Give the session a short, descriptive title.
- Include a concise summary of what the session intends to do.

## Session completion recording

- Before ending a session, record a session-complete event through the same helper.
- Summarize what actually happened, not what was planned. Never record planned work as completed.
- Include the exact next action and every verification check actually performed, passed individually (one flag per check).
- Never hand-edit the activity log or session-state file when the helper is available.
- Check existing activity records first. Never create a duplicate session for work already covered by an existing session-start/session-completed pair.

## Model and effort tracking

- Record whichever of provider, exact model id, model display name, and effort or reasoning level can be directly confirmed for the current session.
- Never infer model or effort from the provider name alone. Never guess an unavailable value — omit the field instead.

## HANDOFF.md maintenance

- Update HANDOFF.md whenever work materially changes project state, decisions, constraints, risks, or next steps.
- Review and update it before compacting context, ending a substantial work session, switching models/agents/tools, or handing the project to another developer or agent.
- Keep it concise: Current state, Work completed, Verification performed, Known problems, Exact next action.
- Inspect the repository and current git state rather than trusting HANDOFF.md blindly before relying on it.

## PROJECT.md maintenance

- Keep PROJECT.md a minimal, accurate overview — what the project is, live URL, stack, owner/operator, pricing or business model where relevant — linking out to CLAUDE.md/AGENTS.md and HANDOFF.md for detail.
- Update it only when the project's fundamentals change (new stack component, new owner, new pricing), not for routine feature work.

## DECISIONS.md maintenance

- Log durable product/architecture decisions worth remembering the reasoning behind, most recent first.
- Only add an entry when a real decision was made — a choice between real alternatives, with a reason — not every code change qualifies.

## Verification rules

- Report only verification that was actually performed. Never claim a build, test, lint run, or manual check that didn't happen.
- Prefer live verification (running the build, running tests, exercising the feature in a browser) over assuming correctness from a diff alone.

## Git safety

- Run `git status` before any command that could discard uncommitted work.
- Never use destructive git operations (`reset --hard`, force-push, `clean -f`, discarding local changes, skipping hooks) without explicit authorization for that specific action.
- Before staging or committing, classify every changed and untracked file. Commit only what's in scope for the current task; leave pre-existing unrelated changes untouched.
- Do not push unless explicitly authorized for that push.

## Warning resolution

- Inspect every warning AI Control Centre currently shows for this project.
- Resolve every warning that's safely actionable (a missing required file, an outdated instruction block, a malformed record).
- Never suppress or hide a warning that reflects a real, unresolved gap. Leaving something as a reported, open warning is correct when there is no safe automatic fix — surface it instead of clearing it.

## Dashboard refresh and verification

- After recording a session, confirm it actually appears in project history — read the activity log and session-state file directly, or refresh the dashboard if it is running. Do not report success without checking.
- Confirm there is no duplicate session, and that HANDOFF.md, DECISIONS.md, PROJECT.md, and the AGENTS.md/CLAUDE.md instruction blocks are all detected as current before calling the work done.
