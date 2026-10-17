// js/api.js
(function (root, factory) {
  const Api = factory();
  const ns = (root.AIChat = root.AIChat || {});
  ns.Api = Api;
  if (typeof module !== 'undefined' && module.exports) module.exports = Api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const MAX_RETRIES = 5;

  function buildBody(model, messages, temperature, maxTokens) {
    return { model: model, messages: messages, temperature: temperature, max_tokens: maxTokens };
  }

  function extractContent(data) {
    if (data && data.choices && data.choices.length > 0) {
      const c = data.choices[0].message && data.choices[0].message.content;
      return (typeof c === 'string') ? c : '';
    }
    return '';
  }

  async function requestChat(cfg, messages, fetchImpl) {
    const f = fetchImpl || fetch;
    const url = (cfg.apiUrl || '').replace(/\/+$/, '');
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await f(`${url}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(buildBody(cfg.model, messages, cfg.temperature, cfg.maxTokens)),
        });
        if (!resp.ok) { lastError = new Error(`HTTP ${resp.status}`); }
        else {
          const data = await resp.json();
          const content = extractContent(data);
          if (content) return { ok: true, content: content, attempts: attempt };
          lastError = new Error('空回复');
        }
      } catch (err) { lastError = err; }
    }
    return { ok: false, content: '', attempts: MAX_RETRIES, lastError: lastError };
  }

  async function fetchModels(apiUrl, apiKey, fetchImpl) {
    const f = fetchImpl || fetch;
    const url = (apiUrl || '').replace(/\/+$/, '');
    const resp = await f(`${url}/models`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data && Array.isArray(data.data)) return data.data.map(m => m.id).filter(Boolean);
    throw new Error('响应格式异常');
  }

  async function testConnection(cfg, fetchImpl) {
    const f = fetchImpl || fetch;
    const url = (cfg.apiUrl || '').replace(/\/+$/, '');
    const resp = await f(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: '你好，请回复"测试成功"。' }], max_tokens: 20 }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return extractContent(await resp.json());
  }

  return { MAX_RETRIES, buildBody, extractContent, requestChat, fetchModels, testConnection };
});
