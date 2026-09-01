# Kindness Is Magic — Agent Instructions

## Environment Constraints

- **You are running inside a minimal Docker container.**
- **No root/sudo access.** You cannot install system packages or run Docker commands. If you want something that requires root, ask the user.
- **Basic shell commands work:** `ls`, `grep`, `find`, `sed`, `awk`, etc.
- **Shell sessions do not persist.** Each `bash` call is a separate invocation — `cd` does not carry over. Always use full paths or prefix commands with `cd /path && ...`.
- **Git is available for inspection.** You can use `git diff`, `git log`, `git blame`, etc. However, do **not** commit or push changes.
- If a tool or package would save significant time, ask the user to install it before rolling your own or working around it.
- **Persistent Python venv at the project root (`.venv`)**

## General Rules

- Follow existing patterns before introducing new abstractions.
- Prefer modifying existing modules over creating new ones.
- Do not add dependencies without asking specifically.
- When introducing new code, prefer current recommended patterns and actively maintained libraries over deprecated approaches.
- **No backward compatibility needed.** The app is not yet deployed. 
- **Do not consider existing users.** The database is wiped regularly.
- **No database downgrade.** The database is wiped regularly so that's a waste of time. No backfill either.
- If something is easily verifiable, **check it instead of wasting time thinking.**
- **Terminology:** a donor's commitment to a family is a "claim" in code but a "sponsorship" in user-facing text.

## Planning

- **A plan orders the work; it doesn't write it.** Capture goal, scope, and traps as the *final state* — outcomes, not the Q&A that produced them; the implementing agent has no memory of this conversation. Don't write a "Decisions" section: a decision is the plan's content — the final state in whatever section it governs. Omit what's easily verifiable during implementation — line numbers, exact code, predicted output; brittle detail derails more than it guides. Length tracks complexity — every line earns its place.
- **The plan settles outcomes; the code is truth for facts.** Prescriptive statements (what the final state should be) are settled — don't re-litigate them. Descriptive claims (how the code currently works) are facts — code wins, correct and move on. If a stale fact merely changes *how* you reach a settled outcome, adapt the mechanism and note it in your report. If implementation shows that the outcome itself is wrong or impossible, stop and surface it — explain what you found and what you'd do instead; don't silently follow a wrong plan, and don't silently pick a different approach.
- **Structure: short preamble, then self-contained stages.** Preamble: goal + scope + anything two or more stages must respect (shared API contracts, model invariants, cross-stage rules). Each stage: what changes there, its validation gate, and every *exception* to the change pattern for that stage — where a mechanical match would do the wrong thing (out-of-scope look-alikes, shared components, same name different concept), not the sites that should change (`rg` finds those). Stages are independently testable and gated before the next (backend before frontend). If something only matters in one stage, keep it there rather than promoting it to the preamble.

## Project Structure

Each directory keeps its own AGENTS.md — **read it before doing anything in that directory**.

- `backend/` — FastAPI + SQLAlchemy backend (Python). See `backend/AGENTS.md`.
- `frontend/` — React + Vite frontend (TypeScript). See `frontend/AGENTS.md`.
- `e2e/` — Playwright end-to-end tests. See `e2e/AGENTS.md`.
