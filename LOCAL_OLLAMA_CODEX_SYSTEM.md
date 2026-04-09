# Local Ollama Codex System

## Goal

Run the real `codex` CLI against a local Ollama-hosted model instead of an OpenAI-hosted model, while keeping Codex's native UX and toolchain intact.

Defaults:

- Model: `qwen3.5:9b`
- Context window: `8192`

## Design

This harness is intentionally thin:

- `codex` remains the process that runs the agent.
- Ollama is selected through Codex's built-in OSS provider path: `--oss --local-provider ollama`.
- Model selection is passed through Codex's native `--model` flag.
- Context length is passed through Codex's native config override path with `-c model_context_window=...`.
- All other arguments are forwarded unchanged to `codex`.
- By default the harness uses its own local `CODEX_HOME` under `.local/codex-home` so local Ollama sessions are not mixed with cloud-backed Codex sessions.

This preserves Codex-native behavior:

- interactive TUI
- `exec`, `review`, `resume`, `mcp`, and other subcommands
- approvals and sandboxing
- MCP servers
- skills, memories, sessions, and other normal Codex state

## File Structure

- `LOCAL_OLLAMA_CODEX_SYSTEM.md`
  - Architecture and operating model.
- `bin/codex-local`
  - Thin launcher that resolves defaults, applies Ollama settings, and then `exec`s the real `codex` binary.
- `bin/codex-local-doctor`
  - Local diagnostics for `codex`, `ollama`, and the configured model.
- `src/telegram-bot.js`
  - Telegram long-polling bridge that routes chat messages into real Codex sessions.
- `src/lib/codex.js`
  - Codex process launcher and session-resolution helpers for the bot.
- `src/lib/state.js`
  - Persistent bot conversation state management.
- `TELEGRAM_BOT.md`
  - Telegram bot command model and operational notes.
- `package.json`
  - Convenience npm scripts so the harness can be invoked consistently.

Telegram bot defaults:

- workspace: `.local/telegram-bot/workspace`
- data: `.local/telegram-bot/data`
- bot Codex home: `.local/telegram-bot/codex-home`

## Parameter Model

Runtime parameters can come from either environment variables or wrapper flags.

Environment variables:

- `CODEX_OLLAMA_MODEL`
- `CODEX_CONTEXT_WINDOW`

Wrapper flags:

- `--model <name>` or `-m <name>`
- `--context-window <tokens>`
- `--context-window=<tokens>`

Precedence:

1. explicit wrapper flags
2. environment variables
3. built-in defaults

## Execution Flow

1. Resolve the actual `codex` binary from `PATH`.
2. Resolve model and context window.
3. Check whether the caller already supplied `-c model_context_window=...`.
4. Invoke:

   ```sh
   codex --oss --local-provider ollama --model <model> -c model_context_window=<tokens> ...
   ```

5. Hand off execution with `exec` so the running process is the real Codex CLI.

## Constraints

- This harness does not replace or reimplement Codex internals.
- It depends on a local Ollama installation and a running Ollama service.
- `model_context_window` configures Codex's context budgeting. The selected Ollama model must also be able to serve that context size.
- Capability retention means Codex-side features stay available. Actual quality of tool use still depends on the local model.
- `codex exec resume` does not accept `--oss` / `--local-provider`, so the harness only allows it inside a harness-managed local `CODEX_HOME`. This avoids falling back to cloud-backed sessions.

## Verification Plan

- Wrapper help and version passthrough.
- Wrapper subcommand passthrough.
- Doctor script validation.
- Runtime check against Ollama when it is installed.
