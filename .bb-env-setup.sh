#!/usr/bin/env bash
# bb runs this in each new managed worktree before the thread starts.
# Non-fatal: without dependencies, the worktree still opens and npm run check reports the gap.
npm ci || echo "npm ci failed; run it before npm run check" >&2
