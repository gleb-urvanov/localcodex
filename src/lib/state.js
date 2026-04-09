const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_STATE = {
  version: 1,
  chats: {},
};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function getOrCreateChat(state, chatId) {
  if (!state.chats[chatId]) {
    state.chats[chatId] = {
      currentConversationId: null,
      conversations: [],
    };
  }

  return state.chats[chatId];
}

function listConversations(chatState) {
  return [...chatState.conversations].sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function findConversation(chatState, conversationIdOrPrefix) {
  return chatState.conversations.find((conversation) => {
    return (
      conversation.id === conversationIdOrPrefix ||
      conversation.id.startsWith(conversationIdOrPrefix)
    );
  });
}

module.exports = {
  DEFAULT_STATE,
  ensureDir,
  findConversation,
  getOrCreateChat,
  listConversations,
  readJson,
  writeJsonAtomic,
};
