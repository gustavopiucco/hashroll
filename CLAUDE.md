# CLAUDE.md

## Language

The whole project is in **English**: code, identifiers, comments, docstrings, test names, error messages, UI text, logs, docs (README, ROADMAP, etc.) and commit messages. Write any new content in English, and translate any non-English text you come across when touching a file.

The user may chat in Portuguese; reply in the user's language, but keep everything that goes into the repository in English.

Do not edit generated code by hand: `solana/client/src/idl/` is produced by `npm run build:program`.

## Commit workflow

After every change:

1. Suggest a commit message (English, Conventional Commits style, e.g. `feat(api): add seed rotation endpoint`).
2. Wait for the user's approval. Do not commit without it.
3. Once approved, commit automatically and then **push to the remote** (`git push`) without asking again.

If the user edits the suggested message, use their version.
