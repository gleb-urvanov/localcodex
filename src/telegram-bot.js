#!/usr/bin/env node

const crypto = require("node:crypto");
const path = require("node:path");

const {
  ensureDir,
  findConversation,
  getOrCreateChat,
  listConversations,
  readJson,
  writeJsonAtomic,
} = require("./lib/state");
const { runCodexTurn } = require("./lib/codex");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.CODEX_TELEGRAM_DATA_DIR || path.join(ROOT, ".local", "telegram-bot");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const CODEX_HOME =
  process.env.CODEX_TELEGRAM_CODEX_HOME || path.join(DATA_DIR, "codex-home");
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const MODEL = process.env.CODEX_OLLAMA_MODEL || "qwen3.5:9b";
const CONTEXT_WINDOW = Number(process.env.CODEX_CONTEXT_WINDOW || "8192");
const WORKSPACE_ROOT = process.env.CODEX_TELEGRAM_WORKSPACE || ROOT;
const CODEX_BIN = process.env.CODEX_LOCAL_BIN || path.join(ROOT, "bin", "codex-local");
const ALLOWED_CHAT_IDS = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const TELEGRAM_MESSAGE_LIMIT = 4000;

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(
    [
      "Telegram Codex bot",
      "",
      "Environment:",
      "  TELEGRAM_BOT_TOKEN          required",
      "  TELEGRAM_ALLOWED_CHAT_IDS   optional comma-separated whitelist",
      "  CODEX_OLLAMA_MODEL          optional, default qwen3.5:9b",
      "  CODEX_CONTEXT_WINDOW        optional, default 8192",
      "  CODEX_TELEGRAM_WORKSPACE    optional workspace root",
      "  CODEX_TELEGRAM_DATA_DIR     optional bot state directory",
      "  CODEX_TELEGRAM_CODEX_HOME   optional Codex home used by the bot",
      "  CODEX_LOCAL_BIN             optional path to bin/codex-local",
      "",
      "Run:",
      "  npm run telegram:bot",
    ].join("\n"),
  );
  process.exit(0);
}

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

ensureDir(DATA_DIR);
ensureDir(CODEX_HOME);

let updateOffset = 0;
let turnQueue = Promise.resolve();

function readState() {
  return readJson(STATE_PATH, { version: 1, chats: {} });
}

function saveState(state) {
  writeJsonAtomic(STATE_PATH, state);
}

function isAllowedChat(chatId) {
  if (ALLOWED_CHAT_IDS.size === 0) {
    return true;
  }

  return ALLOWED_CHAT_IDS.has(String(chatId));
}

async function telegram(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json();
  if (!json.ok) {
    throw new Error(json.description || `Telegram API error calling ${method}`);
  }

  return json.result;
}

function splitMessage(text) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > TELEGRAM_MESSAGE_LIMIT) {
    let splitIndex = remaining.lastIndexOf("\n", TELEGRAM_MESSAGE_LIMIT);
    if (splitIndex < TELEGRAM_MESSAGE_LIMIT / 2) {
      splitIndex = TELEGRAM_MESSAGE_LIMIT;
    }
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n+/, "");
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

async function sendText(chatId, text) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await telegram("sendMessage", {
      chat_id: chatId,
      text: chunk,
    });
  }
}

function createConversation(chatState, title) {
  const now = new Date().toISOString();
  const conversation = {
    id: crypto.randomUUID(),
    title,
    sessionId: null,
    createdAt: now,
    updatedAt: now,
  };

  chatState.conversations.push(conversation);
  chatState.currentConversationId = conversation.id;
  return conversation;
}

function formatConversationList(chatState) {
  const conversations = listConversations(chatState);
  if (conversations.length === 0) {
    return "No bot-managed conversations yet. Use /new to create one.";
  }

  return conversations
    .map((conversation, index) => {
      const currentMarker =
        conversation.id === chatState.currentConversationId ? ">" : " ";
      const sessionPart = conversation.sessionId
        ? conversation.sessionId.slice(0, 8)
        : "pending";

      return `${currentMarker} ${index + 1}. ${conversation.title} [${sessionPart}]`;
    })
    .join("\n");
}

function helpText() {
  return [
    "Commands:",
    "/new [title] - start a new conversation and make it active",
    "/conversations - list bot conversations",
    "/switch <number|id-prefix> - switch active conversation",
    "/current - show the active conversation",
    "/help - show this help",
    "",
    "Any non-command message is sent to the active Codex conversation.",
  ].join("\n");
}

function currentConversation(chatState) {
  if (!chatState.currentConversationId) {
    return null;
  }

  return findConversation(chatState, chatState.currentConversationId);
}

function parseCommand(text) {
  const [rawCommand, ...rest] = text.trim().split(/\s+/);
  const normalizedCommand = rawCommand.toLowerCase().split("@")[0];
  return {
    command: normalizedCommand,
    argText: rest.join(" ").trim(),
  };
}

async function handleCommand(chatId, text) {
  const state = readState();
  const chatState = getOrCreateChat(state, String(chatId));
  const { command, argText } = parseCommand(text);

  if (command === "/start" || command === "/help") {
    return helpText();
  }

  if (command === "/new") {
    const title = argText || `Conversation ${chatState.conversations.length + 1}`;
    const conversation = createConversation(chatState, title);
    saveState(state);
    return `Active conversation: ${conversation.title}\nID: ${conversation.id}`;
  }

  if (command === "/conversations") {
    return formatConversationList(chatState);
  }

  if (command === "/current") {
    const conversation = currentConversation(chatState);
    if (!conversation) {
      return "No active conversation. Use /new to create one.";
    }

    return [
      `Active: ${conversation.title}`,
      `Bot conversation ID: ${conversation.id}`,
      `Codex session: ${conversation.sessionId || "not started yet"}`,
    ].join("\n");
  }

  if (command === "/switch") {
    if (!argText) {
      return "Usage: /switch <number|id-prefix>";
    }

    const conversations = listConversations(chatState);
    let conversation = null;

    if (/^\d+$/.test(argText)) {
      const index = Number(argText) - 1;
      conversation = conversations[index] || null;
    } else {
      conversation = findConversation(chatState, argText);
    }

    if (!conversation) {
      return `Conversation not found: ${argText}`;
    }

    chatState.currentConversationId = conversation.id;
    conversation.updatedAt = new Date().toISOString();
    saveState(state);

    return `Switched to: ${conversation.title}\nID: ${conversation.id}`;
  }

  return "Unknown command. Use /help.";
}

async function handlePrompt(chatId, text) {
  const state = readState();
  const chatState = getOrCreateChat(state, String(chatId));
  let conversation = currentConversation(chatState);

  if (!conversation) {
    conversation = createConversation(chatState, `Conversation ${chatState.conversations.length + 1}`);
    saveState(state);
  }

  let result;
  try {
    result = await runCodexTurn({
      prompt: text,
      sessionId: conversation.sessionId,
      codexHome: CODEX_HOME,
      workspaceRoot: WORKSPACE_ROOT,
      binPath: CODEX_BIN,
      model: MODEL,
      contextWindow: CONTEXT_WINDOW,
    });
  } catch (error) {
    if (error.sessionId) {
      const errorState = readState();
      const errorChatState = getOrCreateChat(errorState, String(chatId));
      const errorConversation = findConversation(errorChatState, conversation.id);
      if (errorConversation && !errorConversation.sessionId) {
        errorConversation.sessionId = error.sessionId;
        errorConversation.updatedAt = new Date().toISOString();
        saveState(errorState);
      }
    }
    throw error;
  }

  const freshState = readState();
  const freshChatState = getOrCreateChat(freshState, String(chatId));
  const freshConversation = findConversation(freshChatState, conversation.id);

  if (!freshConversation) {
    throw new Error("Conversation disappeared while processing the turn");
  }

  freshConversation.sessionId = result.sessionId || freshConversation.sessionId;
  freshConversation.updatedAt = new Date().toISOString();
  saveState(freshState);

  return result.reply || "(Codex completed without a final text reply.)";
}

function enqueueTurn(task) {
  turnQueue = turnQueue.then(task, task);
  return turnQueue;
}

async function processMessage(message) {
  if (!message.chat || !message.text) {
    return;
  }

  const chatId = message.chat.id;
  if (!isAllowedChat(chatId)) {
    await sendText(chatId, "This chat is not authorized for the bot.");
    return;
  }

  if (message.text.startsWith("/")) {
    const reply = await handleCommand(chatId, message.text);
    await sendText(chatId, reply);
    return;
  }

  await telegram("sendChatAction", {
    chat_id: chatId,
    action: "typing",
  });

  const reply = await enqueueTurn(() => handlePrompt(chatId, message.text));
  await sendText(chatId, reply);
}

async function poll() {
  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset: updateOffset,
        timeout: 30,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        updateOffset = update.update_id + 1;
        try {
          await processMessage(update.message);
        } catch (error) {
          const chatId = update.message && update.message.chat && update.message.chat.id;
          if (chatId) {
            await sendText(chatId, `Error: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.error(`[telegram-bot] ${error.stack || error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function main() {
  console.log("Telegram Codex bot starting");
  console.log(`Workspace: ${WORKSPACE_ROOT}`);
  console.log(`Codex home: ${CODEX_HOME}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Context window: ${CONTEXT_WINDOW}`);
  await poll();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
