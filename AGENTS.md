# Kindness Is Magic — Agent Instructions

## Environment Constraints

- **You are running inside a minimal Docker container.**
- **No Docker-in-Docker.** Do not attempt `docker compose` or `docker run`.
- **No root/sudo access.** You cannot install system packages.
- **Basic shell commands work:** `ls`, `grep`, `find`, `sed`, `awk`, etc.
- **Git is available for inspection.** You can use `git diff`, `git log`, `git blame`, etc. However, do **not** commit or push changes.

## General Rules

- Follow existing patterns before introducing new abstractions.
- Prefer modifying existing modules over creating new ones.
- Do not add dependencies without asking specifically.

## Project Structure

- `backend/` — FastAPI + SQLAlchemy backend (Python). See `backend/AGENTS.md`.
- `frontend/` — React + Vite frontend (JavaScript/JSX). See `frontend/AGENTS.md`.
