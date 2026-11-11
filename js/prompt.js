(function (root, factory) {
  const Prompt = factory(root);
  const ns = (root.AIChat = root.AIChat || {});
  ns.Prompt = Prompt;
  if (typeof module !== 'undefined' && module.exports) module.exports = Prompt;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  function getStore() {
    if (typeof module !== 'undefined' && module.exports) return require('./store.js');
    return root.AIChat.Store;
  }

  function roleCardText(r, name) {
    r = r || {};
    return [`[NAME]${name||''}`, `[BASIC]${r.basic||''}`, `[PERSONALITY]${r.personality||''}`, `[BACKGROUND]${r.background||''}`, `[STYLE]${r.style||''}`].join('\n');
  }

  function userCardText(u) {
    u = u || {};
    return [`[NAME]${u.name||''}`, `[BASIC]${u.basic||''}`, `[PERSONALITY]${u.personality||''}`, `[BACKGROUND]${u.background||''}`].join('\n');
  }

  function recentContext(messages, limit) {
    const Store = getStore();
    return (messages || []).slice(-(limit || 8)).map(m => Store.currentContent(m)).join('\n');
  }

  function matchWorldBook(entries, context) {
    const hits = [];
    (entries || []).forEach(e => {
      if (!e || e.enabled === false) return;
      if (e.alwaysInclude) { hits.push(e.content); return; }
      const key = (e.key || '').trim();
      if (!key) return;
      if (e.isRegex) {
        try {
          let matched = new RegExp(key, 'i').test(context);
          // JS 的 \b 只识别 ASCII 单词字符；非 ASCII 关键词命中失败时去掉边界断言重试
          if (!matched && /[^\x00-\x7F]/.test(key)) {
            matched = new RegExp(key.replace(/\\b/g, ''), 'i').test(context);
          }
          if (matched) hits.push(e.content);
        } catch (err) { /* 无效正则跳过 */ }
      } else {
        const kws = key.split(/[,，\n]/).map(s => s.trim()).filter(Boolean);
        const lower = context.toLowerCase();
        if (kws.some(k => lower.includes(k.toLowerCase()))) hits.push(e.content);
      }
    });
    return hits;
  }

  function timeGreeting(date) {
    const h = (date || new Date()).getHours();
    if (h < 6) return '深夜'; if (h < 9) return '清晨'; if (h < 12) return '上午';
    if (h < 14) return '中午'; if (h < 18) return '下午'; if (h < 21) return '傍晚';
    return '晚上';
  }

  function buildSystemPrompt(opts) {
    opts = opts || {};
    const c = opts.character || {};
    const parts = [];
    if (opts.globalNotes) parts.push(`【全局注意事项】${opts.globalNotes}`);
    const role = roleCardText(c.roleCard, c.name);
    if (role.trim()) parts.push(`【AI人设】${role}`);
    const user = userCardText(opts.userCard);
    if (user.trim()) parts.push(`【用户人设】${user}`);
    if (opts.worldBookHits && opts.worldBookHits.length) {
      parts.push(`【世界书】${opts.worldBookHits.join('\n')}`);
    }
    const now = opts.now || new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    parts.push(`【当前时间】${timeGreeting(now)} ${hh}:${mm}（用户所在时区）。`);
    parts.push(`【表达要求】像真人一样自然地回应，不要写成作文或总结：
- 内容：只以角色身份说话和思考，不替用户写、不复述用户原话；情绪用动作、语气、细节来“演”，不要直接写“我很生气/我很高兴”。
- 句式：长短句交错，避免每句一样长、每段一样满；不要每次都用同一套开头或结尾，不要总在结尾反问一句，也不要每句都以“你/我”开头。
- 用词：口语化、贴合角色说话风格，避免书面腔、翻译腔、空洞形容词和陈词滥调。
- 节奏：一次只推进当前这一步，别把后面的可能性都铺陈出来。`);
    return '请严格遵循以下设定：\n' + parts.join('\n');
  }

  function buildHistory(messages, limit) {
    const Store = getStore();
    return (messages || []).filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-(limit || 20))
      .map(m => ({ role: m.role, content: Store.currentContent(m) }));
  }

  return { roleCardText, userCardText, recentContext, matchWorldBook, timeGreeting, buildSystemPrompt, buildHistory };
});
