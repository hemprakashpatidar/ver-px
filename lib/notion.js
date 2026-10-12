const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const MAX_RETRIES = 3;

export class NotionError extends Error {
  constructor(status, body) {
    super(`Notion request failed with status ${status}: ${body?.message || 'unknown error'}`);
    this.status = status;
    this.code = body?.code;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const request = async (path, { method = 'GET', body } = {}) => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_SECRET}`,
        'Notion-Version': NOTION_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });

    // Notion allows ~3 requests/second; back off when rate limited
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const retryAfterSeconds = Number(response.headers.get('retry-after')) || 2 ** attempt;
      await sleep(retryAfterSeconds * 1000);
      continue;
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new NotionError(response.status, data);
    }
    return data;
  }
};

// Notion returns at most 100 rows per call; follow the cursor until every page is read
export const queryDatabase = async (databaseId, { filter, sorts } = {}) => {
  const results = [];
  let cursor;
  do {
    const data = await request(`/databases/${databaseId}/query`, {
      method: 'POST',
      body: {
        page_size: 100,
        ...(filter ? { filter } : {}),
        ...(sorts ? { sorts } : {}),
        ...(cursor ? { start_cursor: cursor } : {})
      }
    });
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return results;
};

export const getPage = (pageId) => request(`/pages/${pageId}`);

export const createPage = (databaseId, properties) =>
  request('/pages', { method: 'POST', body: { parent: { database_id: databaseId }, properties } });

export const updatePage = (pageId, changes) =>
  request(`/pages/${pageId}`, { method: 'PATCH', body: changes });
