export type NotionProperty = Record<string, any> | undefined;

const NOTION_VERSION = '2022-06-28';
const NOTION_BASE_URL = 'https://api.notion.com/v1';

export function getNotionToken() {
  const token = process.env.NOTION_TOKEN;
  if (!token) throw new Error('Missing NOTION_TOKEN environment variable.');
  return token;
}

export function getDatabaseId(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} environment variable.`);
  return value;
}

export async function notionRequest(path: string, method: string, body?: unknown) {
  const response = await fetch(`${NOTION_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getNotionToken()}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || `Notion request failed with ${response.status}`;
    throw new Error(message);
  }
  return data;
}

function chunkText(content: string, size = 1900) {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += size) {
    chunks.push(content.slice(index, index + size));
  }
  return chunks;
}

export function plainTextProperty(value: unknown) {
  const content = typeof value === 'string' ? value : value == null ? '' : String(value);
  return {
    rich_text: content
      ? chunkText(content).map((chunk) => ({ type: 'text', text: { content: chunk } }))
      : [],
  };
}

export function titleProperty(value: unknown) {
  const content = typeof value === 'string' ? value : value == null ? '' : String(value);
  return { title: content ? [{ type: 'text', text: { content: content.slice(0, 1900) } }] : [] };
}

export function numberProperty(value: unknown) {
  const number = Number(value);
  return { number: Number.isFinite(number) ? number : 0 };
}

export function urlProperty(value: unknown) {
  const url = typeof value === 'string' && value.trim() ? value.trim() : null;
  return { url };
}

export function selectProperty(value: unknown) {
  const name = typeof value === 'string' && value.trim() ? value.trim() : 'English';
  return { select: { name } };
}

export function dateProperty(value: unknown) {
  const start = typeof value === 'string' && value.trim() ? value.trim() : new Date().toISOString();
  return { date: { start } };
}

export function getTitle(prop: NotionProperty) {
  return prop?.title?.map((item: any) => item.plain_text || '').join('') || '';
}

export function getRichText(prop: NotionProperty) {
  return prop?.rich_text?.map((item: any) => item.plain_text || '').join('') || '';
}

export function getNumber(prop: NotionProperty) {
  return typeof prop?.number === 'number' ? prop.number : 0;
}

export function getUrl(prop: NotionProperty) {
  return typeof prop?.url === 'string' ? prop.url : '';
}

export function getSelect(prop: NotionProperty) {
  return prop?.select?.name || getRichText(prop) || '';
}

export function getDate(prop: NotionProperty) {
  return prop?.date?.start || '';
}

export async function queryAllDatabaseRows(databaseId: string) {
  const rows: any[] = [];
  let start_cursor: string | undefined;

  do {
    const payload: Record<string, unknown> = { page_size: 100 };
    if (start_cursor) payload.start_cursor = start_cursor;
    const data = await notionRequest(`/databases/${databaseId}/query`, 'POST', payload);
    rows.push(...(data.results || []));
    start_cursor = data.has_more ? data.next_cursor : undefined;
  } while (start_cursor);

  return rows;
}
