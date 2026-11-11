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
    if (opts.memory && String(opts.memory).trim()) parts.push(`【长期记忆】${String(opts.memory).trim()}`);
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
- 活在当下：跟着对方此刻的情绪、话题和节奏走。气氛是流动的，语气和长短都随眼前这一刻变——对方轻松，你就轻松、可以短；对方认真或低落，你就认真。别被更早的情绪或记忆里的旧结论困住。
- 风格随上文走：上文是纯对话就只回对话；带动作/心理/环境描写就延续描写。
- 只以角色身份说话思考，不替用户写、不复述原话；情绪用动作、语气、细节演出来，别直接说“我很生气/很高兴”。
- 语言自然口语化，长短句交错。不用刻意凑字数`);
    return '请严格遵循以下设定：\n' + parts.join('\n');
  }

  function buildHistory(messages, limit) {
    const Store = getStore();
    return (messages || []).filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-(limit || 20))
      .map(m => ({ role: m.role, content: Store.currentContent(m) }));
  }

  function buildSummarizeMessages(previousSummary, overflowText) {
    const sys = '你是记忆整理助手。请把下面的对话压缩成一段长期记忆要点，供后续对话参考。保留：用户与角色的喜好/习惯/口头禅、重要剧情、人物关系变化、约定承诺、关键事实，以及双方关系的情绪基调。客观记录，不要下持续性的结论（如“用户一直困扰/回避”），情绪是会变化的。寒暄、闲聊、无关细节一律丢弃。用简洁的中文要点写，控制在400字以内，不要复述原话，不要写“用户说/角色说”这类前缀。';
    const user = (previousSummary && previousSummary.trim() ? '已有记忆：\n' + previousSummary.trim() + '\n\n' : '') + '新增对话：\n' + (overflowText || '');
    return [{ role: 'system', content: sys }, { role: 'user', content: user }];
  }

  return { roleCardText, userCardText, recentContext, matchWorldBook, timeGreeting, buildSystemPrompt, buildHistory, buildSummarizeMessages };
});
