// js/store.js
(function (root, factory) {
  const Store = factory();
  const ns = (root.AIChat = root.AIChat || {});
  ns.Store = Store;
  if (typeof module !== 'undefined' && module.exports) module.exports = Store;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const KEY = 'aiChatData';
  const VERSION = 1;

  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function timeStr(t) { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

  function createDefaultState() {
    return {
      version: VERSION,
      idCounter: 0,
      global: {
        apiUrl: '', apiKey: '', model: '',
        temperature: 0.7,
        replyLength: 500,
        globalNotes: '',
        userCard: { name: '', basic: '', personality: '', background: '', avatar: '' },
      },
      characters: [],
      activeCharacterId: null,
      activeStorylineId: null,
    };
  }

  function defaultRoleCard() { return { name: '', basic: '', personality: '', background: '', style: '' }; }

  function newCharacter(name, mode) {
    return {
      id: uid(), name: name || '新角色', avatar: '',
      mode: (mode === 'story') ? 'story' : 'chat',
      greeting: '',
      roleCard: defaultRoleCard(),
      memorySummary: '',
      worldBook: [],
      storylines: [],
    };
  }

  function newMessage(role, content, state) {
    const now = Date.now();
    return {
      id: ++state.idCounter,
      role: role,
      time: timeStr(now),
      timestamp: now,
      swipes: [{ id: uid(), content: content || '', time: timeStr(now), timestamp: now }],
      swipeIndex: 0,
    };
  }

  function newStoryline(name) {
    return { id: uid(), name: name || '新故事线', createdAt: Date.now(), messages: [] };
  }

  function activeCharacter(state) {
    return (state.characters || []).find(c => c.id === state.activeCharacterId) || null;
  }
  function activeStoryline(state) {
    const c = activeCharacter(state);
    if (!c) return null;
    return (c.storylines || []).find(s => s.id === state.activeStorylineId) || null;
  }

  function addSwipe(msg, content) {
    const now = Date.now();
    msg.swipes.push({ id: uid(), content: content || '', time: timeStr(now), timestamp: now });
    msg.swipeIndex = msg.swipes.length - 1;
    return msg;
  }

  function setSwipeIndex(msg, i) {
    if (!msg.swipes.length) return msg;
    const n = msg.swipes.length;
    msg.swipeIndex = ((i % n) + n) % n;
    return msg;
  }

  function currentContent(msg) {
    const s = msg.swipes && msg.swipes[msg.swipeIndex];
    if (s) return s.content;
    return (typeof msg.content === 'string') ? msg.content : '';
  }

  function deleteMessage(storyline, msgId) {
    const i = storyline.messages.findIndex(m => m.id === msgId);
    if (i !== -1) storyline.messages.splice(i, 1);
    return storyline;
  }

  function deleteAfter(storyline, msgId) {
    const i = storyline.messages.findIndex(m => m.id === msgId);
    if (i !== -1) storyline.messages = storyline.messages.slice(0, i + 1);
    return storyline;
  }

  function branchFrom(storyline, msgId) {
    const i = storyline.messages.findIndex(m => m.id === msgId);
    const end = (i === -1) ? storyline.messages.length : i + 1;
    return {
      id: uid(), name: '新故事线', createdAt: Date.now(),
      messages: JSON.parse(JSON.stringify(storyline.messages.slice(0, end))),
    };
  }

  function normalize(raw) {
    const base = createDefaultState();
    if (!raw || typeof raw !== 'object') return base;
    // Capture the pristine defaults before Object.assign(base, raw) replaces
    // base.global with the incoming (possibly partial) global object.
    const defaultGlobal = base.global;
    const defaultUserCard = base.global.userCard;
    const s = Object.assign(base, raw);
    const rawGlobal = (raw.global && typeof raw.global === 'object') ? raw.global : {};
    s.global = Object.assign(defaultGlobal, rawGlobal);
    s.global.userCard = Object.assign(defaultUserCard, rawGlobal.userCard || {});
    if (!Array.isArray(s.characters)) s.characters = [];
    s.characters.forEach(c => {
      c.roleCard = Object.assign(defaultRoleCard(), c.roleCard || {});
      if (c.mode !== 'story') c.mode = 'chat';
      if (!Array.isArray(c.worldBook)) c.worldBook = [];
      if (!Array.isArray(c.storylines)) c.storylines = [];
      c.storylines.forEach(sl => {
        if (!Array.isArray(sl.messages)) sl.messages = [];
        sl.messages.forEach(m => {
          if (!Array.isArray(m.swipes)) {
            m.swipes = [{ id: uid(), content: m.content || '', time: m.time, timestamp: m.timestamp }];
          }
          if (typeof m.swipeIndex !== 'number') m.swipeIndex = 0;
        });
      });
    });
    if (typeof s.version !== 'number') s.version = VERSION;
    if (typeof s.idCounter !== 'number') s.idCounter = 0;
    return s;
  }

  function loadState(storage) {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return createDefaultState();
      return normalize(JSON.parse(raw));
    } catch (e) { return createDefaultState(); }
  }

  function saveState(state, storage) {
    try { storage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  function exportJSON(state) { return JSON.stringify(state, null, 2); }

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !Array.isArray(data.characters) || !data.global) {
      throw new Error('无效的备份文件');
    }
    return normalize(data);
  }

  return {
    KEY, VERSION, createDefaultState, newCharacter, newMessage, newStoryline,
    activeCharacter, activeStoryline, addSwipe, setSwipeIndex, currentContent,
    deleteMessage, deleteAfter, branchFrom,
    loadState, saveState, normalize, exportJSON, importJSON, timeStr,
  };
});
