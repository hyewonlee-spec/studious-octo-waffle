import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  dateProperty,
  getDatabaseId,
  getDate,
  getNumber,
  getRichText,
  getTitle,
  notionRequest,
  numberProperty,
  plainTextProperty,
  queryAllDatabaseRows,
  titleProperty,
} from './_notion';

function respond(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

function toDeckList(page: any) {
  const props = page.properties || {};
  return {
    pageId: page.id,
    id: page.id,
    deckName: getTitle(props['Deck Name']),
    deckText: getRichText(props['Deck Text']),
    cardCount: getNumber(props['Card Count']),
    notes: getRichText(props.Notes),
    createdAt: getDate(props['Created At']),
    updatedAt: getDate(props['Updated At']),
  };
}

function deckProperties(deck: any, existingCreatedAt?: string) {
  const now = new Date().toISOString();
  return {
    'Deck Name': titleProperty(deck.deckName || 'Untitled deck'),
    'Deck Text': plainTextProperty(deck.deckText || ''),
    'Card Count': numberProperty(deck.cardCount || 0),
    Notes: plainTextProperty(deck.notes || ''),
    'Created At': dateProperty(existingCreatedAt || deck.createdAt || now),
    'Updated At': dateProperty(now),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const databaseId = getDatabaseId('NOTION_DECK_LISTS_DATABASE_ID');

    if (req.method === 'GET') {
      const rows = await queryAllDatabaseRows(databaseId);
      respond(res, 200, { decks: rows.map(toDeckList) });
      return;
    }

    if (req.method === 'POST') {
      const deck = req.body || {};
      const page = await notionRequest('/pages', 'POST', {
        parent: { database_id: databaseId },
        properties: deckProperties(deck),
      });
      respond(res, 200, { deck: toDeckList(page) });
      return;
    }

    if (req.method === 'PATCH') {
      const pageId = String(req.query.pageId || '');
      if (!pageId) {
        respond(res, 400, { error: 'Missing pageId.' });
        return;
      }
      const deck = req.body || {};
      const page = await notionRequest(`/pages/${pageId}`, 'PATCH', {
        properties: deckProperties(deck, deck.createdAt),
      });
      respond(res, 200, { deck: toDeckList(page) });
      return;
    }

    if (req.method === 'DELETE') {
      const pageId = String(req.query.pageId || '');
      if (!pageId) {
        respond(res, 400, { error: 'Missing pageId.' });
        return;
      }
      await notionRequest(`/pages/${pageId}`, 'PATCH', { archived: true });
      respond(res, 200, { ok: true });
      return;
    }

    respond(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error.';
    respond(res, 500, { error: message });
  }
}
