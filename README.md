# Codex Ollama Harness

Run the real Codex CLI against a local Ollama model.

## Defaults

- Model: `qwen3.5:9b`
- Context window: `8192`

## Commands

Interactive Codex:

```sh
./bin/codex-local
```

Non-interactive Codex:

```sh
./bin/codex-local exec "Summarize this repository"
```

Override the model:

```sh
./bin/codex-local --model qwen3.5:14b
```

Override the context window:

```sh
./bin/codex-local --context-window 16384
```

Run diagnostics:

```sh
./bin/codex-local-doctor
```

Use npm scripts:

```sh
npm run codex:local -- --help
npm run codex:local:doctor
npm run telegram:bot
```

## Environment Variables

- `CODEX_OLLAMA_MODEL`
- `CODEX_CONTEXT_WINDOW`
- `CODEX_LOCAL_HOME`
- `CODEX_HOME`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_CHAT_IDS`

## Notes

- The harness executes the installed `codex` binary directly.
- It forces `--oss --local-provider ollama`.
- By default it uses a dedicated local `CODEX_HOME` at `.local/codex-home`.
- `exec resume` is only allowed inside a harness-managed local home, which prevents accidental reuse of cloud-backed sessions.
- It preserves normal Codex features such as subcommands, MCP, approvals, and sandboxing.
- You still need Ollama installed locally and the selected model available.
- Telegram support is implemented in [src/telegram-bot.js](/Users/gleburvanov/Workspace/localcodex/src/telegram-bot.js).

See [LOCAL_OLLAMA_CODEX_SYSTEM.md](/Users/gleburvanov/Workspace/localcodex/LOCAL_OLLAMA_CODEX_SYSTEM.md) for the structure and design.
See [TELEGRAM_BOT.md](/Users/gleburvanov/Workspace/localcodex/TELEGRAM_BOT.md) for Telegram bot behavior.
