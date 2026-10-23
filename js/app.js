// js/app.js
(function () {
  const { createApp, reactive, ref, computed, watch, nextTick } = Vue;

  createApp({
    setup() {
      const Store = AIChat.Store, Prompt = AIChat.Prompt, Api = AIChat.Api;

      const state = reactive(AIChat.Store.loadState(localStorage));
      const activeChar = computed(() => AIChat.Store.activeCharacter(state));
      const activeStoryline = computed(() => AIChat.Store.activeStoryline(state));
      const apiConfigured = computed(() => !!(state.global.apiUrl && state.global.apiKey && state.global.model));
      const inputMessage = ref('');
      const isSending = ref(false);
      const isTyping = ref(false);
      const showDrawer = ref(false);
      const showSettings = ref(false);
      const settingsView = ref('home');
      const drawerShowAllStorylines = ref(false);
      const editingStorylineId = ref(null);

      // 自动持久化
      let saveTimer = null;
      watch(state, () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => AIChat.Store.saveState(state, localStorage), 300);
      }, { deep: true });

      const chatContainer = ref(null);
      const inputTextarea = ref(null);
      function autoResizeTextarea() {
        nextTick(() => {
          const el = inputTextarea.value;
          if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 100) + 'px'; }
        });
      }
      function openSettings() { showSettings.value = true; settingsView.value = 'home'; }

      // —— 消息列表渲染 ——
      const displayMessages = computed(() => {
        const sl = activeStoryline.value;
        return sl ? sl.messages : [];
      });

      function addMessage(role, content, sl, meta) {
        const target = sl || activeStoryline.value;
        if (!target) return null;
        const m = Store.newMessage(role, content, state, meta);
        target.messages.push(m);
        scrollToBottom();
        return m;
      }

      function selectCharacter(id) {
        const c = state.characters.find(x => x.id === id);
        if (!c) return;
        state.activeCharacterId = id;
        if (!c.storylines.length) {
          const sl = Store.newStoryline('新故事线');
          if (c.greeting && c.greeting.trim()) sl.messages.push(Store.newMessage('assistant', c.greeting.trim(), state));
          c.storylines.push(sl);
        }
        state.activeStorylineId = c.storylines[0].id;
        drawerShowAllStorylines.value = false;
        editingStorylineId.value = null;
        showDrawer.value = false;
        scrollToBottom();
      }

      function selectStoryline(id) {
        state.activeStorylineId = id;
        showDrawer.value = false;
        scrollToBottom();
      }

      function newStoryline() {
        const c = activeChar.value;
        if (!c) return;
        const sl = Store.newStoryline('新故事线');
        if (c.greeting && c.greeting.trim()) {
          const m = Store.newMessage('assistant', c.greeting.trim(), state);
          sl.messages.push(m);
        }
        c.storylines.push(sl);
        state.activeStorylineId = sl.id;
        showDrawer.value = false;
        scrollToBottom();
      }

      // —— 左侧抽屉：故事线（默认最近 2 条，可展开全部、可重命名）——
      const sortedStorylines = computed(() => {
        const c = activeChar.value;
        if (!c) return [];
        const lastActive = (s) => (s.messages && s.messages.length) ? s.messages[s.messages.length - 1].timestamp : (s.createdAt || 0);
        return [...c.storylines].sort((a, b) => lastActive(b) - lastActive(a));
      });
      const visibleStorylines = computed(() => drawerShowAllStorylines.value ? sortedStorylines.value : sortedStorylines.value.slice(0, 2));
      function renameStoryline(s) { editingStorylineId.value = null; if (s && s.name) s.name = s.name.trim(); }

      // —— 故事线三点菜单（改名 / 删除）——
      const showStorylineMenu = ref(false);
      const storylineMenuPos = ref({ x: 0, y: 0 });
      const storylineMenuTarget = ref(null);
      function openStorylineMenu(event, s) {
        event.preventDefault();
        storylineMenuTarget.value = s;
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        const menuW = 120, menuH = 96;
        let left = rect.left - menuW;
        if (left < 10) left = rect.right + 4;
        if (left + menuW > window.innerWidth - 10) left = window.innerWidth - menuW - 10;
        let top = rect.top;
        if (top + menuH > window.innerHeight - 10) top = window.innerHeight - menuH - 10;
        if (top < 10) top = 10;
        storylineMenuPos.value = { x: left, y: top };
        showStorylineMenu.value = true;
        nextTick(() => { document.addEventListener('click', closeStorylineMenuOnce); });
      }
      function closeStorylineMenuOnce(e) {
        const el = document.querySelector('.storyline-menu');
        if (el && el.contains(e.target)) return;
        closeStorylineMenu();
      }
      function closeStorylineMenu() {
        showStorylineMenu.value = false;
        storylineMenuTarget.value = null;
        document.removeEventListener('click', closeStorylineMenuOnce);
      }
      function renameStorylineFromMenu() {
        const s = storylineMenuTarget.value;
        closeStorylineMenu();
        if (s) editingStorylineId.value = s.id;
      }
      function deleteStorylineFromMenu() {
        const s = storylineMenuTarget.value;
        closeStorylineMenu();
        deleteStoryline(s);
      }
      function deleteStoryline(s) {
        if (!s) return;
        const c = activeChar.value;
        if (!c) return;
        const i = c.storylines.findIndex(x => x.id === s.id);
        if (i === -1) return;
        c.storylines.splice(i, 1);
        if (state.activeStorylineId === s.id) {
          if (c.storylines.length) {
            state.activeStorylineId = c.storylines[0].id;
          } else {
            const sl = Store.newStoryline('新故事线');
            if (c.greeting && c.greeting.trim()) sl.messages.push(Store.newMessage('assistant', c.greeting.trim(), state));
            c.storylines.push(sl);
            state.activeStorylineId = sl.id;
          }
        }
        drawerShowAllStorylines.value = false;
        editingStorylineId.value = null;
        scrollToBottom();
      }

      // —— 发送 ——
      let isProcessing = false;
      let pendingMessages = [];
      const messageBuffer = ref([]);
      let sendTimer = null;
      const SEND_DELAY = 5000;

      function sendMessage() {
        const text = inputMessage.value.trim();
        if (text) {
          const c = activeChar.value;
          const sl = activeStoryline.value;
          addMessage('user', text, sl);
          inputMessage.value = '';
          autoResizeTextarea();
          if (isProcessing) { pendingMessages.push({ text, sl, c }); return; }
          messageBuffer.value.push({ text, sl, c });
          clearTimeout(sendTimer);
          sendTimer = setTimeout(() => {
            const copy = [...messageBuffer.value];
            messageBuffer.value = [];
            sendTimer = null;
            executeAIChat(copy);
          }, SEND_DELAY);
          return;
        }
        triggerActiveMessage();
      }

      function triggerActiveMessage() {
        if (!apiConfigured.value) { showToastMessage('请先配置 API'); return; }
        if (isProcessing || isSending.value) return;
        const c = activeChar.value;
        if (!c) { showToastMessage('请先创建角色'); return; }
        const sl = activeStoryline.value;
        const entries = Store.worldBookEntries(state, c);
        const worldHits = Prompt.matchWorldBook(entries, Prompt.recentContext(sl ? sl.messages : [], 8));
        const system = Prompt.buildSystemPrompt({
          character: c, userCard: state.global.userCard, globalNotes: state.global.globalNotes,
          worldBookHits: worldHits,
        }) + '\n【主动指令】你是主动推进对话的一方：请根据角色设定与已有对话，自然地继续剧情并直接说出下一句话。只输出一段连贯的话，不要分段。';
        const history = Prompt.buildHistory(sl ? sl.messages : [], state.global.contextLength);
        const worldHit = { count: worldHits.length, total: entries.filter(e => e.enabled !== false).length };
        doRequest(system, history, sl, worldHit, false);
      }

      async function executeAIChat(bufferMessages) {
        isProcessing = true;
        try {
          const first = bufferMessages[0] || {};
          const c = first.c || activeChar.value;
          if (!c) { showToastMessage('请先创建角色'); return; }
          const sl = first.sl || activeStoryline.value;
          const entries = Store.worldBookEntries(state, c);
          const worldHits = Prompt.matchWorldBook(entries, Prompt.recentContext(sl ? sl.messages : [], 8));
          const system = Prompt.buildSystemPrompt({
            character: c, userCard: state.global.userCard, globalNotes: state.global.globalNotes,
            worldBookHits: worldHits,
          });
          const history = Prompt.buildHistory(sl ? sl.messages : [], state.global.contextLength);
          const worldHit = { count: worldHits.length, total: entries.filter(e => e.enabled !== false).length };
          await doRequest(system, history, sl, worldHit);
        } finally {
          isTyping.value = false;
          isProcessing = false;
          if (pendingMessages.length) {
            const copy = [...pendingMessages]; pendingMessages = [];
            messageBuffer.value = copy;
            clearTimeout(sendTimer);
            sendTimer = setTimeout(() => { const c = [...messageBuffer.value]; messageBuffer.value = []; executeAIChat(c); }, SEND_DELAY);
          }
        }
      }

      async function doRequest(system, history, targetSl, worldHit, split) {
        const cfg = { apiUrl: state.global.apiUrl, apiKey: state.global.apiKey, model: state.global.model, temperature: state.global.temperature, maxTokens: state.global.replyLength };
        const full = [{ role: 'system', content: system }, ...history];
        isSending.value = true;
        isTyping.value = true;
        const r = await Api.requestChat(cfg, full);
        isSending.value = false;
        isTyping.value = false;
        if (!r.ok) {
          addMessage('assistant', '', targetSl); // 5 次失败后空白消息
          showToastMessage(r.lastError ? r.lastError.message : '未回复');
          return;
        }
        const meta = { usage: r.usage || null, worldHit: worldHit || { count: 0, total: 0 } };
        const parts = (split === false) ? [r.content] : splitReply(r.content);
        parts.forEach((part, i) => {
          setTimeout(() => addMessage('assistant', part, targetSl, i === 0 ? meta : null), i * 500);
        });
      }

      function splitReply(reply) {
        let parts = reply.split('[SPLIT]').map(s => s.trim()).filter(Boolean);
        if (parts.length <= 1) parts = reply.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
        if (parts.length <= 1) return [reply];
        return parts;
      }

      // —— 工具 ——
      function scrollToBottom() {
        nextTick(() => { const el = chatContainer.value; if (el) el.scrollTop = el.scrollHeight; });
      }
      function onChatScroll() {}
      let toastTimer = null; const toastMessage = ref(''); const showToast = ref(false);
      function showToastMessage(msg) {
        clearTimeout(toastTimer); toastMessage.value = msg; showToast.value = true;
        toastTimer = setTimeout(() => { showToast.value = false; }, 1500);
      }

      // —— 消息三点菜单 ——
      const showMessageMenu = ref(false);
      const menuPosition = ref({ x: 0, y: 0 });
      const targetMessage = ref(null);
      const editingMessageId = ref(null);
      const editingContent = ref('');
      const regeneratingId = ref(null);

      // —— 消息可用性（仅最新 AI 回复可重新回复；最新 AI 回复与最后用户消息可编辑）——
      const lastUser = computed(() => {
        const sl = activeStoryline.value;
        if (!sl) return null;
        for (let i = sl.messages.length - 1; i >= 0; i--) if (sl.messages[i].role === 'user') return sl.messages[i];
        return null;
      });
      const lastAssistant = computed(() => {
        const sl = activeStoryline.value;
        if (!sl) return null;
        for (let i = sl.messages.length - 1; i >= 0; i--) if (sl.messages[i].role === 'assistant') return sl.messages[i];
        return null;
      });
      function isLastMessage(m) {
        const sl = activeStoryline.value;
        return !!(sl && m && sl.messages.length && sl.messages[sl.messages.length - 1].id === m.id);
      }
      function msgMeta(item) {
        if (!item || item.role !== 'assistant') return '';
        const s = Store.currentSwipe(item);
        if (!s) return '';
        const parts = [];
        if (s.usage) {
          const u = s.usage;
          const total = (typeof u.total_tokens === 'number') ? u.total_tokens : ((u.prompt_tokens || 0) + (u.completion_tokens || 0));
          if (total) parts.push('token ' + total);
        }
        if (s.worldHit && s.worldHit.total > 0) parts.push('命中率 ' + Math.round(s.worldHit.count / s.worldHit.total * 100) + '%');
        return parts.join(' · ');
      }
      const canEditTarget = computed(() => {
        const m = targetMessage.value;
        if (!m) return false;
        return (lastUser.value && m.id === lastUser.value.id) || (lastAssistant.value && m.id === lastAssistant.value.id);
      });
      const canReReplyTarget = computed(() => {
        const m = targetMessage.value;
        if (!m || m.role !== 'assistant') return false;
        return !!(lastAssistant.value && m.id === lastAssistant.value.id && isLastMessage(m));
      });

      function openMessageMenu(event, msg) {
        event.preventDefault();
        targetMessage.value = msg;
        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();
        const menuW = 200, menuH = 210;
        let left = rect.left - menuW;
        if (left < 10) left = rect.right + 4;
        if (left + menuW > window.innerWidth - 10) left = window.innerWidth - menuW - 10;
        let top = rect.top;
        if (top + menuH > window.innerHeight - 10) top = window.innerHeight - menuH - 10;
        if (top < 10) top = 10;
        menuPosition.value = { x: left, y: top };
        showMessageMenu.value = true;
        nextTick(() => { document.addEventListener('click', closeMessageMenuOnce); });
      }
      function closeMessageMenuOnce(e) {
        const el = document.querySelector('.message-menu');
        if (el && el.contains(e.target)) return;
        closeMessageMenu();
      }
      function closeMessageMenu() {
        showMessageMenu.value = false;
        targetMessage.value = null;
        document.removeEventListener('click', closeMessageMenuOnce);
      }

      function startEdit(msg) {
        if (!msg) return;
        editingMessageId.value = msg.id;
        editingContent.value = Store.currentContent(msg);
        closeMessageMenu();
      }
      function saveEdit(msg) {
        const text = editingContent.value.trim();
        if (msg.role === 'assistant') {
          Store.addSwipe(msg, text); // AI 消息：保留旧版本，生成分支
        } else {
          msg.swipes[msg.swipeIndex].content = text || Store.currentContent(msg); // 用户消息：直接覆盖
        }
        editingMessageId.value = null;
        editingContent.value = '';
      }
      function cancelEdit() { editingMessageId.value = null; editingContent.value = ''; }

      async function reReply() {
        const msg = targetMessage.value;
        if (!msg || msg.role !== 'assistant') { closeMessageMenu(); return; }
        closeMessageMenu();
        const sl = activeStoryline.value;
        await regenerateAssistant(msg, sl);
      }

      async function regenerateAssistant(targetMsg, targetSl) {
        const sl = targetSl || activeStoryline.value;
        const c = activeChar.value;
        if (!c || !sl) return;
        const historyMsgs = targetMsg ? sl.messages.filter(m => m.id !== targetMsg.id) : sl.messages;
        const entries = Store.worldBookEntries(state, c);
        const worldHits = Prompt.matchWorldBook(entries, Prompt.recentContext(historyMsgs, 8));
        const history = Prompt.buildHistory(historyMsgs, state.global.contextLength);
        const system = Prompt.buildSystemPrompt({
          character: c, userCard: state.global.userCard, globalNotes: state.global.globalNotes,
          worldBookHits: worldHits,
        });
        const worldHit = { count: worldHits.length, total: entries.filter(e => e.enabled !== false).length };
        const cfg = { apiUrl: state.global.apiUrl, apiKey: state.global.apiKey, model: state.global.model, temperature: state.global.temperature, maxTokens: state.global.replyLength };
        if (targetMsg) regeneratingId.value = targetMsg.id;
        let r;
        try {
          r = await Api.requestChat(cfg, [{ role: 'system', content: system }, ...history]);
        } finally {
          if (targetMsg) regeneratingId.value = null;
        }
        if (!r.ok) { showToastMessage('重新回复失败'); return; }
        const meta = { usage: r.usage || null, worldHit };
        if (targetMsg) Store.addSwipe(targetMsg, r.content, meta);
        else addMessage('assistant', r.content, sl, meta);
      }

      function deleteMessage() {
        const msg = targetMessage.value;
        const sl = activeStoryline.value;
        if (!msg || !sl) return;
        Store.deleteMessage(sl, msg.id);
        closeMessageMenu();
      }

      function deleteAfterThis() {
        const msg = targetMessage.value;
        const sl = activeStoryline.value;
        if (!msg || !sl) return;
        Store.deleteAfter(sl, msg.id);
        closeMessageMenu();
      }

      function branchFromHere() {
        const msg = targetMessage.value;
        const c = activeChar.value;
        const sl = activeStoryline.value;
        if (!msg || !c || !sl) return;
        const branch = Store.branchFrom(sl, msg.id);
        branch.name = sl.name + ' · 分支';
        c.storylines.push(branch);
        state.activeStorylineId = branch.id;
        closeMessageMenu();
        scrollToBottom();
        showToastMessage('已复制到新故事线');
      }

      // —— 设置：API / 全局 / 用户 / 数据 ——
      const modelOptions = ref([]); const isFetchingModels = ref(false);
      const testStatus = ref('idle'); const testDetail = ref(''); const isTesting = ref(false);

      function apiCfg() { return { apiUrl: state.global.apiUrl, apiKey: state.global.apiKey, model: state.global.model, temperature: state.global.temperature, maxTokens: state.global.replyLength }; }

      function saveApi() { const g = state.global; if (!g.apiUrl || !g.apiKey || !g.model) { showToastMessage('请完整填写 API 地址、Key 和模型'); return; } showToastMessage('API配置已保存'); }
      async function fetchModels() {
        isFetchingModels.value = true; testDetail.value = '正在获取...';
        try { modelOptions.value = await Api.fetchModels(state.global.apiUrl, state.global.apiKey); testDetail.value = `获取 ${modelOptions.value.length} 个模型`; testStatus.value = 'success'; }
        catch (e) { testDetail.value = e.message; testStatus.value = 'error'; }
        finally { isFetchingModels.value = false; }
      }
      async function runTest() {
        isTesting.value = true; testStatus.value = 'testing'; testDetail.value = '测试中...';
        try { const reply = await Api.testConnection(apiCfg()); testDetail.value = `成功: "${reply}"`; testStatus.value = 'success'; }
        catch (e) { testDetail.value = e.message; testStatus.value = 'error'; }
        finally { isTesting.value = false; }
      }
      function saveGlobal() { showToastMessage('全局设置已保存'); }
      function saveUser() { showToastMessage('用户设定已保存'); }

      function uploadUserAvatar(e) { compressImage(e.target.files[0], d => { state.global.userCard.avatar = d; }); }
      function removeUserAvatar() { state.global.userCard.avatar = ''; }
      // 压缩头像并裁剪为圆形（256px，PNG 透明底）
      function compressImage(file, callback) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const SIZE = 256;
            const canvas = document.createElement('canvas');
            canvas.width = SIZE;
            canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            const side = Math.min(img.width, img.height);
            const sx = (img.width - side) / 2;
            const sy = (img.height - side) / 2;
            ctx.beginPath();
            ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
            const dataUrl = canvas.toDataURL('image/png');
            callback(dataUrl);
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      }

      function exportData() {
        const blob = new Blob([Store.exportJSON(state)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ai_chat_backup_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(a.href);
        showToastMessage('数据导出成功');
      }
      function importData() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = e => {
          const file = e.target.files[0]; if (!file) return;
          const reader = new FileReader();
          reader.onload = ev => {
            try {
              const next = Store.importJSON(ev.target.result);
              Object.keys(state).forEach(k => delete state[k]);
              Object.assign(state, next);
              Store.saveState(state, localStorage);
              showToastMessage('导入成功'); location.reload();
            } catch (err) { alert('导入失败：' + err.message); }
          };
          reader.readAsText(file);
        };
        input.click();
      }

      // —— 全屏编辑器（通用：可编辑任意对象字段） ——
      const fullscreenVisible = ref(false); const fullscreenTitle = ref(''); const fullscreenContent = ref('');
      let fullscreenTarget = null, fullscreenField = '';
      function openFullscreenFor(target, field, title) {
        fullscreenTarget = target;
        fullscreenField = field;
        fullscreenTitle.value = title || field;
        fullscreenContent.value = (target && typeof target[field] === 'string') ? target[field] : '';
        fullscreenVisible.value = true;
      }
      function confirmFullscreen() { if (fullscreenTarget) fullscreenTarget[fullscreenField] = fullscreenContent.value; fullscreenVisible.value = false; }
      function closeFullscreen() { fullscreenVisible.value = false; }

      // —— 设置：角色管理 ——
      const editingCharId = ref(null);
      const editingChar = computed(() => state.characters.find(c => c.id === editingCharId.value) || null);

      function createCharacter() {
        const c = Store.newCharacter('新角色');
        state.characters.push(c);
        editingCharId.value = c.id;
        settingsView.value = 'characterEdit';
      }
      function openCharacterEdit(id) { editingCharId.value = id; settingsView.value = 'characterEdit'; }
      function saveCharacter() { showToastMessage('角色已保存'); settingsView.value = 'characters'; }
      function deleteCharacter() {
        const c = editingChar.value; if (!c) return;
        if (!confirm('确定删除该角色及其所有故事线？')) return;
        const i = state.characters.findIndex(x => x.id === c.id);
        state.characters.splice(i, 1);
        if (state.activeCharacterId === c.id) {
          state.activeCharacterId = state.characters.length ? state.characters[0].id : null;
          state.activeStorylineId = state.characters.length ? state.characters[0].storylines[0]?.id || null : null;
        }
        settingsView.value = 'characters';
      }

      function uploadRoleAvatar(e) { compressImage(e.target.files[0], d => { if (editingChar.value) editingChar.value.avatar = d; }); }
      function removeRoleAvatar() { if (editingChar.value) editingChar.value.avatar = ''; }

      // —— 设置：全局世界书 ——
      function addWorldBook() {
        state.global.worldBooks.push({ id: Math.random().toString(36).slice(2,10), name: '新世界书', entries: [] });
      }
      function deleteWorldBook(id) {
        const i = state.global.worldBooks.findIndex(w => w.id === id);
        if (i === -1) return;
        state.global.worldBooks.splice(i, 1);
        state.characters.forEach(c => { if (c.worldBookId === id) c.worldBookId = null; });
      }
      function addWorldBookEntry(wb) { wb.entries.push({ id: Math.random().toString(36).slice(2,10), key: '', content: '', enabled: true, isRegex: false, alwaysInclude: false }); }
      function removeWorldBookEntry(wb, i) { wb.entries.splice(i, 1); }

      return {
        state, Store, activeChar, activeStoryline, apiConfigured,
        inputMessage, isSending, isTyping, showDrawer, showSettings, settingsView,
        chatContainer, inputTextarea, autoResizeTextarea, openSettings,
        displayMessages, addMessage, selectCharacter, selectStoryline,
        newStoryline, sendMessage, triggerActiveMessage,
        scrollToBottom, onChatScroll,
        showToast, toastMessage, showToastMessage,
        showMessageMenu, menuPosition, targetMessage, editingMessageId, editingContent,
        openMessageMenu, closeMessageMenu, startEdit, saveEdit, cancelEdit,
        reReply, deleteMessage, deleteAfterThis, branchFromHere,
        canEditTarget, canReReplyTarget, isLastMessage, regeneratingId, msgMeta,
        drawerShowAllStorylines, visibleStorylines, editingStorylineId, renameStoryline,
        showStorylineMenu, storylineMenuPos, openStorylineMenu, renameStorylineFromMenu, deleteStorylineFromMenu, deleteStoryline,
        modelOptions, isFetchingModels, testStatus, testDetail, isTesting,
        saveApi, fetchModels, runTest, saveGlobal, saveUser,
        uploadUserAvatar, removeUserAvatar, exportData, importData,
        fullscreenVisible, fullscreenTitle, fullscreenContent,
        openFullscreenFor, confirmFullscreen, closeFullscreen,
        editingCharId, editingChar, createCharacter, openCharacterEdit,
        saveCharacter, deleteCharacter, uploadRoleAvatar, removeRoleAvatar,
        addWorldBook, deleteWorldBook, addWorldBookEntry, removeWorldBookEntry,
      };
    }
  }).mount('#app');
})();
