import {
  dateProperty,
  getDatabaseId,
  getDate,
  getJsonBody,
  getNumber,
  getRichText,
  getTitle,
  notionRequest,
  numberProperty,
  plainTextProperty,
  queryAllDatabaseRows,
  sendJson,
  sendMethodNotAllowed,
  titleProperty,
} from './_notion.js';

function toDeckList(page) {
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

function deckProperties(deck, existingCreatedAt) {
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

export default async function handler(req, res) {
  try {
    const databaseId = getDatabaseId('NOTION_DECK_LISTS_DATABASE_ID');

    if (req.method === 'GET') {
      const rows = await queryAllDatabaseRows(databaseId);
      sendJson(res, 200, { ok: true, decks: rows.map(toDeckList) });
      return;
    }

    if (req.method === 'POST') {
      const deck = await getJsonBody(req);
      const page = await notionRequest('/pages', 'POST', {
        parent: { database_id: databaseId },
        properties: deckProperties(deck),
      });
      sendJson(res, 200, { ok: true, deck: toDeckList(page) });
      return;
    }

    if (req.method === 'PATCH') {
      const pageId = String(req.query?.pageId || '');
      if (!pageId) {
        sendJson(res, 400, { ok: false, error: 'Missing pageId.' });
        return;
      }

      const deck = await getJsonBody(req);
      const page = await notionRequest(`/pages/${pageId}`, 'PATCH', {
        properties: deckProperties(deck, deck.createdAt),
      });
      sendJson(res, 200, { ok: true, deck: toDeckList(page) });
      return;
    }

    if (req.method === 'DELETE') {
      const pageId = String(req.query?.pageId || '');
      if (!pageId) {
        sendJson(res, 400, { ok: false, error: 'Missing pageId.' });
        return;
      }

      await notionRequest(`/pages/${pageId}`, 'PATCH', { archived: true });
      sendJson(res, 200, { ok: true });
      return;
    }

    sendMethodNotAllowed(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error.';
    sendJson(res, 500, {
      ok: false,
      route: '/api/decks',
      error: message,
      help: 'Check Vercel environment variables and make sure the Notion integration is connected to the Deck Lists database.',
    });
  }
}
