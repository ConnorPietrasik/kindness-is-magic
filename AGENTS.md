# Kindness Is Magic — Agent Instructions

## Environment Constraints

- **You are running inside a minimal Docker container.**
- **No Docker-in-Docker.** Do not attempt `docker compose` or `docker run`.
- **No root/sudo access.** You cannot install system packages.
- **Basic shell commands work:** `ls`, `grep`, `find`, `sed`, `awk`, etc.
- **Shell sessions do not persist.** Each `bash` call is a separate invocation — `cd` does not carry over. Always use full paths or prefix commands with `cd /path && ...`.
- **Git is available for inspection.** You can use `git diff`, `git log`, `git blame`, etc. However, do **not** commit or push changes.

## General Rules

- Follow existing patterns before introducing new abstractions.
- Prefer modifying existing modules over creating new ones.
- Do not add dependencies without asking specifically.
- When introducing new code, prefer current recommended patterns and actively maintained libraries over deprecated approaches.

## Planning

- **Break large changes into independently testable parts.** When practical, split changes that touch multiple areas into sections that can each be validated on their own. This keeps implementation steps small and reduces the risk of cascading failures.
- **Keep plans concise.** A plan should describe the changes being made, the approach, and important considerations. Do not reproduce exact code diffs or inline implementations. Save detailed code changes for the implementation phase.

## Project Structure

- `backend/` — FastAPI + SQLAlchemy backend (Python). See `backend/AGENTS.md`.
- `frontend/` — React + Vite frontend (TypeScript). See `frontend/AGENTS.md`.
