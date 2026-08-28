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
- If something is easily verifiable, **check it instead of wasting time thinking.**

## Planning

- **Plans are contracts, not scripts.** Capture what makes the change *right* and what's expensive to rediscover: goal, scope boundaries (including what's explicitly out of scope), naming/behavior decisions, non-obvious traps, and stage gates. Omit what's easily verifiable during implementation — line numbers, exact code or string literals, predicted command output. Brittle detail biases the agent toward following the plan instead of the code, and a single stale detail can derail execution.
- **Decisions are expressed as outcomes in the plan** (the chosen name, the chosen approach) — not restated in a separate "approved decisions" section.
- **Break large changes into independently testable stages**, each with a validation gate before the next stage begins. Always do backend before frontend.
- **Length is fine when every line earns its place.** A complex change with many traps needs a longer plan. Cut detail the code will answer anyway. A plan carries the results of blast-radius investigation: every *exception* to the change pattern — where a mechanical pattern match would do the wrong thing (out-of-scope matches that look identical, shared components, same name, different concept). Don't enumerate the sites that *should* change — `rg` finds them and doing them right is the default. Traps are where it isn't.

## Project Structure

Each directory keeps its own AGENTS.md — **read it before doing anything in that directory**.

- `backend/` — FastAPI + SQLAlchemy backend (Python). See `backend/AGENTS.md`.
- `frontend/` — React + Vite frontend (TypeScript). See `frontend/AGENTS.md`.
- `e2e/` — Playwright end-to-end tests. See `e2e/AGENTS.md`.
