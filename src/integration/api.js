import { safeJsonParse, text } from '../engine/utils.js';

function sleep(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function customEndpoint(baseUrl) {
  const raw = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) throw new Error('请填写独立 API 的 Base URL');
  const endpoint = raw.endsWith('/chat/completions') ? raw : `${raw}/chat/completions`;
  const url = new URL(endpoint);
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('独立 API 必须使用 HTTPS；本机开发接口可使用 HTTP');
  }
  return url.toString();
}

function responseText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('');
  if (typeof content === 'string') return content;
  if (typeof payload?.output_text === 'string') return payload.output_text;
  throw new Error('API 响应中没有可读取的文本内容');
}

export class WorldAPI {
  constructor({ getContext, getSettings }) {
    this.getContext = getContext;
    this.getSettings = getSettings;
  }

  async completeJson(prompt, { signal, systemPrompt } = {}) {
    const settings = this.getSettings();
    const retries = Math.max(0, Number(settings.maxRetries) || 0);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const raw = settings.connectionMode === 'custom'
          ? await this.requestCustom(prompt, { signal, systemPrompt })
          : await this.requestSillyTavern(prompt, { signal, systemPrompt });
        return safeJsonParse(raw);
      } catch (error) {
        lastError = error;
        if (error?.name === 'AbortError') throw error;
        if (attempt < retries) await sleep(600 * (attempt + 1), signal);
      }
    }
    throw lastError || new Error('后台推演请求失败');
  }

  async requestSillyTavern(prompt, { systemPrompt }) {
    const context = this.getContext();
    if (!context?.generateRaw) throw new Error('当前酒馆版本不支持 generateRaw，请升级酒馆或配置独立 API');
    return context.generateRaw({
      prompt: text(prompt, 120000),
      systemPrompt: systemPrompt || '你是结构化世界模拟意图生成器。只输出合法 JSON，不输出 Markdown。',
      temperature: Number(this.getSettings().temperature) || 0.7,
      maxTokens: Number(this.getSettings().maxTokens) || 12000,
    });
  }

  async requestCustom(prompt, { signal, systemPrompt }) {
    const settings = this.getSettings();
    if (!settings.customModel) throw new Error('请填写独立 API 的模型名');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('API 请求超时')), Math.max(10, Number(settings.requestTimeout) || 120) * 1000);
    const body = {
      model: settings.customModel,
      messages: [
        { role: 'system', content: systemPrompt || '你是结构化世界模拟意图生成器。只输出合法 JSON，不输出 Markdown。' },
        { role: 'user', content: prompt },
      ],
      temperature: Number(settings.temperature) || 0.7,
      max_tokens: Number(settings.maxTokens) || 12000,
      response_format: { type: 'json_object' },
    };
    const headers = { 'Content-Type': 'application/json' };
    if (settings.customApiKey) headers.Authorization = `Bearer ${settings.customApiKey}`;
    try {
      let response = await fetch(customEndpoint(settings.customBaseUrl), {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      });
      if (response.status === 400) {
        delete body.response_format;
        response = await fetch(customEndpoint(settings.customBaseUrl), {
          method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
        });
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(`API ${response.status}：${detail || response.statusText}`);
      }
      return responseText(await response.json());
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  async testConnection() {
    return this.completeJson('只返回 {"ok":true}', { systemPrompt: '只输出指定 JSON。' });
  }
}
