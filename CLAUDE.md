# CLAUDE.md

## Dev server in a git worktree

Before starting the dev server in a **new git worktree**, copy the gitignored env file in first:

```bash
cp ~/Developer/JARVIS/.env.local <worktree>/.env.local
```

- Copy the **entire** file — a real copy, not a symlink.
- It's gitignored, so it's never committed and fresh worktrees don't inherit it.
- Skip this and `next dev` boots but `/dashboard` shows **"Backend unavailable / Missing NEXT_PUBLIC_SUPABASE_URL"**.
- Then `pnpm install` if `node_modules` is missing, and start the server.

(Worktrees are fine to use for this repo — the old "work in place only" rule was removed.)
