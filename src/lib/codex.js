const fs = require("node:fs");
const os = require("node:os");
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

function resolveSessionId(beforeIndex, afterIndex, knownSessionIds) {
  const beforeIds = new Set(beforeIndex.map((entry) => entry.id));

  const directMatch = afterIndex.find((entry) => !beforeIds.has(entry.id));
  if (directMatch) {
    return directMatch.id;
  }

  const knownIds = new Set(knownSessionIds.filter(Boolean));
  const fallback = [...afterIndex]
    .filter((entry) => !knownIds.has(entry.id))
    .sort((left, right) => {
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    })[0];

  return fallback ? fallback.id : null;
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
    const outputPath = path.join(
      os.tmpdir(),
      `codex-local-bot-output-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`,
    );

    const args = [];

    if (sessionId) {
      args.push("exec", "resume", sessionId, prompt);
    } else {
      args.push("exec", prompt);
    }

    args.push("--skip-git-repo-check");
    args.push("--output-last-message", outputPath);
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

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);

    child.on("close", (code) => {
      const afterIndex = readSessionIndex(codexHome);
      let reply = "";

      try {
        reply = sanitizeOutput(fs.readFileSync(outputPath, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") {
          return reject(error);
        }
      } finally {
        try {
          fs.unlinkSync(outputPath);
        } catch {}
      }

      const resolvedSessionId =
        sessionId ||
        resolveSessionId(
          beforeIndex,
          afterIndex,
          beforeIndex.map((entry) => entry.id),
        );

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
