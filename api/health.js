import { cleanDatabaseId, sendJson } from './_notion.js';

function hasValue(name) {
  return Boolean(process.env[name] && String(process.env[name]).trim());
}

export default function handler(req, res) {
  sendJson(res, 200, {
    ok: true,
    message: 'Arcane Binder API is running.',
    environment: {
      NOTION_TOKEN: hasValue('NOTION_TOKEN') ? 'set' : 'missing',
      NOTION_OWNED_CARDS_DATABASE_ID: hasValue('NOTION_OWNED_CARDS_DATABASE_ID') ? 'set' : 'missing',
      NOTION_DECK_LISTS_DATABASE_ID: hasValue('NOTION_DECK_LISTS_DATABASE_ID') ? 'set' : 'missing',
    },
    cleanedDatabaseIds: {
      ownedCards: hasValue('NOTION_OWNED_CARDS_DATABASE_ID')
        ? cleanDatabaseId(process.env.NOTION_OWNED_CARDS_DATABASE_ID)
        : null,
      deckLists: hasValue('NOTION_DECK_LISTS_DATABASE_ID')
        ? cleanDatabaseId(process.env.NOTION_DECK_LISTS_DATABASE_ID)
        : null,
    },
  });
}
