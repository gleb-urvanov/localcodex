# Telegram Bot Support

## Goal

Expose the local Codex Ollama harness through a Telegram bot while keeping real Codex sessions underneath.

## Supported Commands

- `/new [title]`
  - Create a new bot-managed conversation and make it active.
- `/conversations`
  - List existing bot-managed conversations for the current Telegram chat.
- `/switch <number|id-prefix>`
  - Switch the active conversation.
- `/current`
  - Show the active conversation and linked Codex session.
- `/help`
  - Show command help.

Any normal text message is sent to the active conversation.

## Session Model

The bot keeps its own per-chat conversation registry in `.local/telegram-bot/state.json`.

Each bot conversation stores:

- bot conversation id
- title
- linked Codex session id, once initialized
- timestamps

When a conversation has no linked Codex session yet, the first user message starts a fresh `codex-local exec ...` run. After that completes, the bot resolves and stores the created Codex session id. Later turns use `codex-local exec resume <session-id> ...`.

## Execution Model

- Telegram transport uses long polling via the Bot API.
- Bot turns are serialized through a single in-process queue so session creation stays deterministic.
- Codex is invoked through `bin/codex-local`, not through a reimplemented agent loop.

## Required Environment

- `TELEGRAM_BOT_TOKEN`

Optional:

- `TELEGRAM_ALLOWED_CHAT_IDS`
- `CODEX_OLLAMA_MODEL`
- `CODEX_CONTEXT_WINDOW`
- `CODEX_TELEGRAM_WORKSPACE`
- `CODEX_TELEGRAM_DATA_DIR`
- `CODEX_TELEGRAM_CODEX_HOME`
- `CODEX_LOCAL_BIN`

## Run

```sh
npm run telegram:bot
```

## Notes

- The bot tracks only conversations it created itself.
- If you want full separation from your desktop Codex sessions, set `CODEX_TELEGRAM_CODEX_HOME`.
- Ollama must still be installed and available for Codex turns to succeed.
