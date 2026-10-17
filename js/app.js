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
        if (!sl) return [];
        const msgs = sl.messages;
        const out = [];
        const five = 5 * 60 * 1000;
        msgs.forEach((m, i) => {
          if (i === 0 || (m.timestamp - msgs[i - 1].timestamp) > five) {
            out.push({ type: 'time-label', key: 't' + m.id, timestamp: m.timestamp, displayTime: formatTimeLabel(m.timestamp) });
          }
          out.push(Object.assign({ key: 'm' + m.id }, m));
        });
        return out;
      });

      function formatTimeLabel(t) {
        const d = new Date(t);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return `${months[d.getMonth()]} ${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }

      function addMessage(role, content, sl) {
        const target = sl || activeStoryline.value;
        if (!target) return null;
        const m = Store.newMessage(role, content, state);
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
        showDrawer.value = false;
        scrollToBottom();
      }

      function selectStoryline(id) {
        state.activeStorylineId = id;
        showDrawer.value = false;
        scrollToBottom();
      }

      function newCharacter() {
        const c = Store.newCharacter('新角色', 'chat');
        state.characters.push(c);
        state.activeCharacterId = c.id;
        if (!c.storylines.length) c.storylines.push(Store.newStoryline('新故事线'));
        state.activeStorylineId = c.storylines[0].id;
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
        if (!apiConfigured.value) { showToastMessage('⚠️ 请先配置 API'); return; }
        if (isProcessing || isSending.value) return;
        // 主动消息：构建不含历史、带主动指令的系统提示
        const c = activeChar.value;
        if (!c) { showToastMessage('请先创建角色'); return; }
        const sl = activeStoryline.value;
        const parts = [];
        parts.push(`【主动指令】你是主动发起对话的一方，请根据角色设定主动说一句话开启话题。`);
        parts.push(`【格式要求】${c.mode === 'chat' ? '只回复“要说的话”，禁止动作/心理/环境/旁白描写。' : '可以包含动作、心理、环境等描写。'}`);
        const system = '请严格遵循以下设定：\n' + parts.join('\n') + '\n' + Prompt.buildSystemPrompt({ character: c, userCard: state.global.userCard, globalNotes: state.global.globalNotes, memorySummary: c.mode === 'chat' ? c.memorySummary : '' });
        doRequest(system, [], sl);
      }

      async function executeAIChat(bufferMessages) {
        isProcessing = true;
        try {
          const first = bufferMessages[0] || {};
          const c = first.c || activeChar.value;
          if (!c) { showToastMessage('请先创建角色'); return; }
          const sl = first.sl || activeStoryline.value;
          const worldHits = Prompt.matchWorldBook(c.worldBook, Prompt.recentContext(sl ? sl.messages : [], 8));
          const system = Prompt.buildSystemPrompt({
            character: c, userCard: state.global.userCard, globalNotes: state.global.globalNotes,
            memorySummary: c.mode === 'chat' ? c.memorySummary : '', worldBookHits: worldHits,
          });
          const history = Prompt.buildHistory(sl ? sl.messages : [], 20);
          await doRequest(system, history, sl);
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

      async function doRequest(system, history, targetSl) {
        const cfg = { apiUrl: state.global.apiUrl, apiKey: state.global.apiKey, model: state.global.model, temperature: state.global.temperature, maxTokens: state.global.replyLength };
        const full = [{ role: 'system', content: system }, ...history];
        isSending.value = true;
        isTyping.value = true;
        const r = await Api.requestChat(cfg, full);
        isSending.value = false;
        isTyping.value = false;
        if (!r.ok) {
          addMessage('assistant', '', targetSl); // 5 次失败后空白消息
          showToastMessage('⚠️ ' + (r.lastError ? r.lastError.message : '未回复'));
          return;
        }
        splitReply(r.content).forEach((part, i) => {
          setTimeout(() => addMessage('assistant', part, targetSl), i * 500);
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
        if (activeChar.value && activeChar.value.mode === 'story') {
          Store.addSwipe(msg, text); // 剧情向：追加分支
        } else {
          msg.swipes[msg.swipeIndex].content = text || Store.currentContent(msg);
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
        const history = Prompt.buildHistory(historyMsgs, 20);
        const system = Prompt.buildSystemPrompt({
          character: c, userCard: state.global.userCard, globalNotes: state.global.globalNotes,
          memorySummary: c.mode === 'chat' ? c.memorySummary : '',
          worldBookHits: Prompt.matchWorldBook(c.worldBook, Prompt.recentContext(historyMsgs, 8)),
        });
        const cfg = { apiUrl: state.global.apiUrl, apiKey: state.global.apiKey, model: state.global.model, temperature: state.global.temperature, maxTokens: state.global.replyLength };
        isTyping.value = true;
        const r = await Api.requestChat(cfg, [{ role: 'system', content: system }, ...history]);
        isTyping.value = false;
        if (!r.ok) { showToastMessage('⚠️ 重新回复失败'); return; }
        if (targetMsg) {
          if (c.mode === 'story') Store.addSwipe(targetMsg, r.content);
          else targetMsg.swipes[targetMsg.swipeIndex].content = r.content;
        } else {
          addMessage('assistant', r.content, sl);
        }
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
        showToastMessage('✅ 已复制到新故事线');
      }

      // —— 设置：API / 全局 / 用户 / 数据 ——
      const modelOptions = ref([]); const isFetchingModels = ref(false);
      const testStatus = ref('idle'); const testDetail = ref(''); const isTesting = ref(false);

      function apiCfg() { return { apiUrl: state.global.apiUrl, apiKey: state.global.apiKey, model: state.global.model, temperature: state.global.temperature, maxTokens: state.global.replyLength }; }

      function saveApi() { const g = state.global; if (!g.apiUrl || !g.apiKey || !g.model) { showToastMessage('请完整填写 API 地址、Key 和模型'); return; } showToastMessage('✅ API配置已保存'); }
      async function fetchModels() {
        isFetchingModels.value = true; testDetail.value = '正在获取...';
        try { modelOptions.value = await Api.fetchModels(state.global.apiUrl, state.global.apiKey); testDetail.value = `获取 ${modelOptions.value.length} 个模型`; testStatus.value = 'success'; }
        catch (e) { testDetail.value = '❌ ' + e.message; testStatus.value = 'error'; }
        finally { isFetchingModels.value = false; }
      }
      async function runTest() {
        isTesting.value = true; testStatus.value = 'testing'; testDetail.value = '测试中...';
        try { const reply = await Api.testConnection(apiCfg()); testDetail.value = `✅ 成功: "${reply}"`; testStatus.value = 'success'; }
        catch (e) { testDetail.value = '❌ ' + e.message; testStatus.value = 'error'; }
        finally { isTesting.value = false; }
      }
      function saveGlobal() { showToastMessage('✅ 全局设置已保存'); }
      function saveUser() { showToastMessage('✅ 用户设定已保存'); }

      function uploadUserAvatar(e) { compressImage(e.target.files[0], d => { state.global.userCard.avatar = d; }); }
      function removeUserAvatar() { state.global.userCard.avatar = ''; }
      // 压缩头像（最大 200px，JPEG 0.7）
      function compressImage(file, callback) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 200;
            const MAX_HEIGHT = 200;
            let width = img.width;
            let height = img.height;
            if (width > height) {
              if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
            } else {
              if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
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
        showToastMessage('✅ 数据导出成功');
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
              showToastMessage('✅ 导入成功'); location.reload();
            } catch (err) { alert('❌ 导入失败：' + err.message); }
          };
          reader.readAsText(file);
        };
        input.click();
      }

      // —— 全屏编辑器（Ruling B） ——
      const fullscreenVisible = ref(false); const fullscreenTitle = ref(''); const fullscreenContent = ref('');
      let fullscreenTarget = null, fullscreenField = '';
      function openFullscreen(field) { fullscreenTarget = state.global; fullscreenField = field; fullscreenTitle.value = field; fullscreenContent.value = fullscreenTarget[field] || ''; fullscreenVisible.value = true; }
      function confirmFullscreen() { fullscreenTarget[fullscreenField] = fullscreenContent.value; fullscreenVisible.value = false; }
      function closeFullscreen() { fullscreenVisible.value = false; }

      // —— 设置：角色管理 ——
      const editingCharId = ref(null);
      const charTab = ref('base');
      const editingChar = computed(() => state.characters.find(c => c.id === editingCharId.value) || null);

      function createCharacter() {
        const c = Store.newCharacter('新角色', 'chat');
        state.characters.push(c);
        editingCharId.value = c.id;
        charTab.value = 'base';
        settingsView.value = 'characterEdit';
      }
      function openCharacterEdit(id) { editingCharId.value = id; charTab.value = 'base'; settingsView.value = 'characterEdit'; }
      function saveCharacter() { showToastMessage('✅ 角色已保存'); settingsView.value = 'characters'; }
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

      function addWorldBookEntry() { editingChar.value.worldBook.push({ id: Math.random().toString(36).slice(2,10), key: '', content: '', enabled: true, isRegex: false, alwaysInclude: false }); }
      function removeWorldBookEntry(i) { editingChar.value.worldBook.splice(i, 1); }

      function newStorylineForChar() {
        const c = editingChar.value; if (!c) return;
        const sl = Store.newStoryline('新故事线');
        if (c.greeting && c.greeting.trim()) sl.messages.push(Store.newMessage('assistant', c.greeting.trim(), state));
        c.storylines.push(sl);
      }
      function deleteStoryline(id) {
        const c = editingChar.value; if (!c) return;
        const i = c.storylines.findIndex(s => s.id === id);
        if (i === -1) return;
        c.storylines.splice(i, 1);
        if (state.activeStorylineId === id) state.activeStorylineId = c.storylines.length ? c.storylines[0].id : null;
      }

      function uploadRoleAvatar(e) { compressImage(e.target.files[0], d => { if (editingChar.value) editingChar.value.avatar = d; }); }
      function removeRoleAvatar() { if (editingChar.value) editingChar.value.avatar = ''; }

      function openFullscreenChar(field) { fullscreenTarget = editingChar.value; fullscreenField = field; fullscreenTitle.value = field; fullscreenContent.value = fullscreenTarget[field] || ''; fullscreenVisible.value = true; }

      return {
        state, Store, activeChar, activeStoryline, apiConfigured,
        inputMessage, isSending, isTyping, showDrawer, showSettings, settingsView,
        chatContainer, inputTextarea, autoResizeTextarea, openSettings,
        displayMessages, addMessage, selectCharacter, selectStoryline,
        newCharacter, newStoryline, sendMessage, triggerActiveMessage,
        scrollToBottom, onChatScroll, formatTimeLabel,
        showToast, toastMessage, showToastMessage,
        showMessageMenu, menuPosition, targetMessage, editingMessageId, editingContent,
        openMessageMenu, closeMessageMenu, startEdit, saveEdit, cancelEdit,
        reReply, deleteMessage, deleteAfterThis, branchFromHere,
        modelOptions, isFetchingModels, testStatus, testDetail, isTesting,
        saveApi, fetchModels, runTest, saveGlobal, saveUser,
        uploadUserAvatar, removeUserAvatar, exportData, importData,
        fullscreenVisible, fullscreenTitle, fullscreenContent,
        openFullscreen, confirmFullscreen, closeFullscreen,
        editingCharId, charTab, editingChar, createCharacter, openCharacterEdit,
        saveCharacter, deleteCharacter, addWorldBookEntry, removeWorldBookEntry,
        newStorylineForChar, deleteStoryline, uploadRoleAvatar, removeRoleAvatar,
        openFullscreenChar,
      };
    }
  }).mount('#app');
})();
