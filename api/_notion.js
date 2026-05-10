const NOTION_VERSION = '2022-06-28';
const NOTION_BASE_URL = 'https://api.notion.com/v1';

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function sendMethodNotAllowed(res) {
  sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
}

export function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing ${name} environment variable in Vercel.`);
  }
  return String(value).trim();
}

export function getNotionToken() {
  return getRequiredEnv('NOTION_TOKEN');
}

export function cleanDatabaseId(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;

  // Accept either a raw Notion database ID or a full Notion database URL.
  const match = raw.match(/[0-9a-fA-F]{32}/);
  if (match) return match[0];

  return raw
    .replace(/^https?:\/\/www\.notion\.so\//, '')
    .replace(/^https?:\/\/notion\.so\//, '')
    .split('?')[0]
    .split('#')[0]
    .replace(/-/g, '')
    .trim();
}

export function getDatabaseId(envName) {
  return cleanDatabaseId(getRequiredEnv(envName));
}

export async function getJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

export async function notionRequest(path, method, body) {
  let response;

  try {
    response = await fetch(`${NOTION_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${getNotionToken()}`,
        'Content-Type': 'application/json',
        'Notion-Version': NOTION_VERSION,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network error.';
    throw new Error(`Could not reach Notion API: ${message}`);
  }

  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const notionMessage = data?.message || data?.error || text || `Notion request failed with status ${response.status}.`;
    throw new Error(`Notion ${response.status}: ${notionMessage}`);
  }

  return data;
}

function chunkText(content, size = 1900) {
  const chunks = [];
  const safeContent = String(content || '');

  for (let index = 0; index < safeContent.length; index += size) {
    chunks.push(safeContent.slice(index, index + size));
  }

  return chunks;
}

export function plainTextProperty(value) {
  const content = value == null ? '' : String(value);
  return {
    rich_text: content
      ? chunkText(content).map((chunk) => ({ type: 'text', text: { content: chunk } }))
      : [],
  };
}

export function titleProperty(value) {
  const content = value == null ? '' : String(value);
  return {
    title: content ? [{ type: 'text', text: { content: content.slice(0, 1900) } }] : [],
  };
}

export function numberProperty(value) {
  const numericValue = Number(value);
  return { number: Number.isFinite(numericValue) ? numericValue : 0 };
}

export function urlProperty(value) {
  const url = typeof value === 'string' && value.trim() ? value.trim() : null;
  return { url };
}

export function selectProperty(value) {
  const name = typeof value === 'string' && value.trim() ? value.trim() : 'English';
  return { select: { name } };
}

export function dateProperty(value) {
  const start = typeof value === 'string' && value.trim() ? value.trim() : new Date().toISOString();
  return { date: { start } };
}

export function getTitle(prop) {
  return prop?.title?.map((item) => item.plain_text || '').join('') || '';
}

export function getRichText(prop) {
  return prop?.rich_text?.map((item) => item.plain_text || '').join('') || '';
}

export function getNumber(prop) {
  return typeof prop?.number === 'number' ? prop.number : 0;
}

export function getUrl(prop) {
  return typeof prop?.url === 'string' ? prop.url : '';
}

export function getSelect(prop) {
  return prop?.select?.name || getRichText(prop) || '';
}

export function getDate(prop) {
  return prop?.date?.start || '';
}

export async function queryAllDatabaseRows(databaseId) {
  const rows = [];
  let startCursor;

  do {
    const payload = { page_size: 100 };
    if (startCursor) payload.start_cursor = startCursor;

    const data = await notionRequest(`/databases/${databaseId}/query`, 'POST', payload);
    rows.push(...(data.results || []));
    startCursor = data.has_more ? data.next_cursor : undefined;
  } while (startCursor);

  return rows;
}
