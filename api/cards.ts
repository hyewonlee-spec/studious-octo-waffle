import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  dateProperty,
  getDatabaseId,
  getDate,
  getNumber,
  getRichText,
  getSelect,
  getTitle,
  getUrl,
  notionRequest,
  numberProperty,
  plainTextProperty,
  queryAllDatabaseRows,
  selectProperty,
  titleProperty,
  urlProperty,
} from './_notion';

function respond(res: VercelResponse, status: number, body: unknown) {
  res.status(status).json(body);
}

function toOwnedCard(page: any) {
  const props = page.properties || {};
  return {
    pageId: page.id,
    id: page.id,
    scryfallId: getRichText(props['Scryfall ID']),
    name: getTitle(props['Card Name']),
    setName: getRichText(props['Set Name']),
    setCode: getRichText(props['Set Code']),
    collectorNumber: getRichText(props['Collector Number']),
    imageUrl: getUrl(props['Image URL']),
    totalQuantity: getNumber(props['Total Quantity']),
    foilQuantity: getNumber(props['Foil Quantity']),
    nonfoilQuantity: getNumber(props['Non-Foil Quantity']),
    language: getSelect(props.Language),
    notes: getRichText(props.Notes),
    addedAt: getDate(props['Added At']),
    updatedAt: getDate(props['Updated At']),
  };
}

function ownedCardProperties(card: any, existingAddedAt?: string) {
  const now = new Date().toISOString();
  const foilQuantity = Math.max(0, Number(card.foilQuantity || 0));
  const nonfoilQuantity = Math.max(0, Number(card.nonfoilQuantity || 0));
  const totalQuantity = Math.max(0, Number(card.totalQuantity ?? foilQuantity + nonfoilQuantity));

  return {
    'Card Name': titleProperty(card.name),
    'Scryfall ID': plainTextProperty(card.scryfallId),
    'Set Name': plainTextProperty(card.setName),
    'Set Code': plainTextProperty(String(card.setCode || '').toUpperCase()),
    'Collector Number': plainTextProperty(card.collectorNumber),
    'Image URL': urlProperty(card.imageUrl),
    'Total Quantity': numberProperty(totalQuantity),
    'Foil Quantity': numberProperty(foilQuantity),
    'Non-Foil Quantity': numberProperty(nonfoilQuantity),
    Language: selectProperty(card.language || 'English'),
    Notes: plainTextProperty(card.notes || ''),
    'Added At': dateProperty(existingAddedAt || card.addedAt || now),
    'Updated At': dateProperty(now),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const databaseId = getDatabaseId('NOTION_OWNED_CARDS_DATABASE_ID');

    if (req.method === 'GET') {
      const rows = await queryAllDatabaseRows(databaseId);
      respond(res, 200, { cards: rows.map(toOwnedCard) });
      return;
    }

    if (req.method === 'POST') {
      const card = req.body || {};
      const payload = {
        parent: { database_id: databaseId },
        properties: ownedCardProperties(card),
      };
      const page = await notionRequest('/pages', 'POST', payload);
      respond(res, 200, { card: toOwnedCard(page) });
      return;
    }

    if (req.method === 'PATCH') {
      const pageId = String(req.query.pageId || '');
      if (!pageId) {
        respond(res, 400, { error: 'Missing pageId.' });
        return;
      }
      const card = req.body || {};
      const page = await notionRequest(`/pages/${pageId}`, 'PATCH', {
        properties: ownedCardProperties(card, card.addedAt),
      });
      respond(res, 200, { card: toOwnedCard(page) });
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
