const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function readSessionIndex(codexHome) {
  const sessionIndexPath = path.join(codexHome, "session_index.jsonl");
  try {
    const lines = fs
      .readFileSync(sessionIndexPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    return lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function sanitizeOutput(text) {
  return text.replace(/\r/g, "").trim();
}

function runCodexTurn({
  prompt,
  sessionId,
  codexHome,
  workspaceRoot,
  binPath,
  model,
  contextWindow,
}) {
  return new Promise((resolve, reject) => {
    const beforeIndex = readSessionIndex(codexHome);

    const args = [];

    if (sessionId) {
      args.push("exec", "resume", sessionId, prompt);
    } else {
      args.push("exec", prompt);
    }

    args.push("--skip-git-repo-check");
    args.push("--json");
    args.push("--color", "never");
    args.push("--model", model);
    args.push("--context-window", String(contextWindow));

    const child = spawn(binPath, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        CODEX_OLLAMA_MODEL: model,
        CODEX_CONTEXT_WINDOW: String(contextWindow),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let resolvedSessionId = sessionId || null;
    const replyParts = [];

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      stdoutBuffer += text;

      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

        if (line.startsWith("{") && line.endsWith("}")) {
          try {
            const event = JSON.parse(line);
            if (event.type === "thread.started" && event.thread_id) {
              resolvedSessionId = event.thread_id;
            }
            if (
              event.type === "item.completed" &&
              event.item &&
              event.item.type === "agent_message" &&
              typeof event.item.text === "string" &&
              event.item.text.length > 0
            ) {
              replyParts.push(event.item.text);
            }
          } catch {}
        }

        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);

    child.on("close", (code) => {
      const afterIndex = readSessionIndex(codexHome);
      let reply = replyParts.join("");

      if (!resolvedSessionId) {
        const beforeIds = new Set(beforeIndex.map((entry) => entry.id));
        const directMatch = afterIndex.find((entry) => !beforeIds.has(entry.id));
        if (directMatch) {
          resolvedSessionId = directMatch.id;
        }
      }

      if (!reply) {
        reply = sanitizeOutput(stdoutBuffer) || sanitizeOutput(stdout);
      }

      if (code !== 0) {
        const error = new Error(
          sanitizeOutput(stderr) ||
            sanitizeOutput(stdout) ||
            `Codex exited with status ${code}`,
        );
        error.code = code;
        error.sessionId = resolvedSessionId;
        return reject(error);
      }

      resolve({
        reply,
        sessionId: resolvedSessionId,
        stdout: sanitizeOutput(stdout),
        stderr: sanitizeOutput(stderr),
      });
    });
  });
}

module.exports = {
  readSessionIndex,
  runCodexTurn,
};
