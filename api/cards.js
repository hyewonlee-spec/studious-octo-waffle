import {
  dateProperty,
  getDatabaseId,
  getDate,
  getJsonBody,
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
  sendJson,
  sendMethodNotAllowed,
  titleProperty,
  urlProperty,
} from './_notion.js';


function getNumberOrFormula(prop) {
  if (typeof prop?.number === 'number') return prop.number;
  if (typeof prop?.formula?.number === 'number') return prop.formula.number;
  return 0;
}

function normaliseQuantity(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

function toOwnedCard(page) {
  const props = page.properties || {};
  const foilQuantity = normaliseQuantity(getNumber(props['Foil Quantity']));
  const nonfoilQuantity = normaliseQuantity(getNumber(props['Non-Foil Quantity']));
  const splitTotal = foilQuantity + nonfoilQuantity;
  const storedTotal = normaliseQuantity(getNumberOrFormula(props['Total Quantity']));

  return {
    pageId: page.id,
    id: page.id,
    scryfallId: getRichText(props['Scryfall ID']),
    name: getTitle(props['Card Name']),
    setName: getRichText(props['Set Name']),
    setCode: getRichText(props['Set Code']),
    collectorNumber: getRichText(props['Collector Number']),
    imageUrl: getUrl(props['Image URL']),
    totalQuantity: splitTotal > 0 ? splitTotal : storedTotal,
    foilQuantity,
    nonfoilQuantity,
    language: getSelect(props.Language),
    notes: getRichText(props.Notes),
    addedAt: getDate(props['Added At']),
    updatedAt: getDate(props['Updated At']),
  };
}

function ownedCardProperties(card, existingAddedAt) {
  const now = new Date().toISOString();
  const foilQuantity = normaliseQuantity(card.foilQuantity);
  const nonfoilQuantity = normaliseQuantity(card.nonfoilQuantity);

  // Total Quantity is intentionally not written here.
  // It should be calculated from Foil Quantity + Non-Foil Quantity so it never becomes a separate count.
  return {
    'Card Name': titleProperty(card.name || 'Untitled card'),
    'Scryfall ID': plainTextProperty(card.scryfallId || ''),
    'Set Name': plainTextProperty(card.setName || ''),
    'Set Code': plainTextProperty(String(card.setCode || '').toUpperCase()),
    'Collector Number': plainTextProperty(card.collectorNumber || ''),
    'Image URL': urlProperty(card.imageUrl || ''),
    'Foil Quantity': numberProperty(foilQuantity),
    'Non-Foil Quantity': numberProperty(nonfoilQuantity),
    Language: selectProperty(card.language || 'English'),
    Notes: plainTextProperty(card.notes || ''),
    'Added At': dateProperty(existingAddedAt || card.addedAt || now),
    'Updated At': dateProperty(now),
  };
}

export default async function handler(req, res) {
  try {
    const databaseId = getDatabaseId('NOTION_OWNED_CARDS_DATABASE_ID');

    if (req.method === 'GET') {
      const rows = await queryAllDatabaseRows(databaseId);
      sendJson(res, 200, { ok: true, cards: rows.map(toOwnedCard) });
      return;
    }

    if (req.method === 'POST') {
      const card = await getJsonBody(req);
      const page = await notionRequest('/pages', 'POST', {
        parent: { database_id: databaseId },
        properties: ownedCardProperties(card),
      });
      sendJson(res, 200, { ok: true, card: toOwnedCard(page) });
      return;
    }

    if (req.method === 'PATCH') {
      const pageId = String(req.query?.pageId || '');
      if (!pageId) {
        sendJson(res, 400, { ok: false, error: 'Missing pageId.' });
        return;
      }

      const card = await getJsonBody(req);
      const page = await notionRequest(`/pages/${pageId}`, 'PATCH', {
        properties: ownedCardProperties(card, card.addedAt),
      });
      sendJson(res, 200, { ok: true, card: toOwnedCard(page) });
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
      route: '/api/cards',
      error: message,
      help: 'Check Vercel environment variables and make sure the Notion integration is connected to the Owned Cards database.',
    });
  }
}
