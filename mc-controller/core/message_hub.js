import { v4 as uuid } from 'uuid';
import config from '../config.js';

class MessageHub {
  constructor() {
    this.inboxes = new Map();
  }

  ensureInbox(botId) {
    if (!this.inboxes.has(botId)) {
      this.inboxes.set(botId, []);
    }
  }

  send(from, to, type, content) {
    this.ensureInbox(to);
    const msg = {
      id: uuid(),
      from,
      to,
      type: type || 'chat',
      content,
      timestamp: Date.now(),
    };
    const inbox = this.inboxes.get(to);
    inbox.push(msg);
    if (inbox.length > config.messages.maxPerInbox) {
      inbox.splice(0, inbox.length - config.messages.maxPerInbox);
    }
    return { messageId: msg.id, delivered: true };
  }

  broadcast(from, type, content, allBotIds) {
    const results = [];
    for (const botId of allBotIds) {
      if (botId !== from) {
        results.push(this.send(from, botId, type, content));
      }
    }
    return { sent: results.length, messageIds: results.map(r => r.messageId) };
  }

  getMessages(botId, since = 0, limit = 50) {
    this.ensureInbox(botId);
    const inbox = this.inboxes.get(botId);
    const filtered = since > 0 ? inbox.filter(m => m.timestamp > since) : inbox;
    return filtered.slice(-limit);
  }

  getUnreadCount(botId) {
    this.ensureInbox(botId);
    return this.inboxes.get(botId).length;
  }

  clearMessages(botId, beforeTimestamp) {
    if (!this.inboxes.has(botId)) return;
    if (beforeTimestamp) {
      const inbox = this.inboxes.get(botId);
      const idx = inbox.findIndex(m => m.timestamp > beforeTimestamp);
      if (idx > 0) inbox.splice(0, idx);
      else if (idx === -1) inbox.length = 0;
    } else {
      this.inboxes.set(botId, []);
    }
  }

  systemMessage(to, type, content) {
    return this.send('system', to, type, content);
  }
}

const messageHub = new MessageHub();
export default messageHub;
