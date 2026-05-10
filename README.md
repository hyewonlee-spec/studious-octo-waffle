# Arcane Binder

A mobile-friendly Magic: The Gathering personal card library app.

## What this version tracks

This app only tracks:

- Card ownership
- Quantity
- Foil quantity
- Non-foil quantity
- Language
- Exact set / printing
- Personal notes
- 100-card deck lists that can be copied as plain text

It does not include condition, pricing, format legality, trade status, wishlist, scanner mode, locations or favourites.

## Tech stack

- React
- Vite
- TypeScript
- Vercel serverless API routes
- Notion as the database
- Scryfall for MTG card search and card images

## Notion setup

Import these CSV files into Notion first:

1. `notion-csv/notion_owned_cards_template.csv`
2. `notion-csv/notion_deck_lists_template.csv`

After import, delete the sample rows.

### Owned Cards database properties

The app expects these exact property names and types:

| Property | Notion type |
|---|---|
| Card Name | Title |
| Scryfall ID | Text |
| Set Name | Text |
| Set Code | Text |
| Collector Number | Text |
| Image URL | URL |
| Total Quantity | Number |
| Foil Quantity | Number |
| Non-Foil Quantity | Number |
| Language | Select |
| Notes | Text |
| Added At | Date |
| Updated At | Date |

### Deck Lists database properties

The app expects these exact property names and types:

| Property | Notion type |
|---|---|
| Deck Name | Title |
| Deck Text | Text |
| Card Count | Number |
| Notes | Text |
| Created At | Date |
| Updated At | Date |

## Notion integration setup

1. Create a Notion internal integration.
2. Copy the integration secret.
3. Share both Notion databases with the integration.
4. Copy each database ID from the Notion database URL.

## Vercel environment variables

Add these in Vercel → Project → Settings → Environment Variables:

```env
NOTION_TOKEN=secret_your_notion_integration_token
NOTION_OWNED_CARDS_DATABASE_ID=your_owned_cards_database_id
NOTION_DECK_LISTS_DATABASE_ID=your_deck_lists_database_id
```

After adding or changing environment variables, redeploy the Vercel project.

## Local development

```bash
npm install
npm run dev
```

Create a local `.env` file using `.env.example`.

## Deploying

1. Upload this folder to a GitHub repository.
2. Import the repository into Vercel.
3. Add the environment variables.
4. Deploy.

## Notes

Scryfall card search runs in the browser. Notion write/read actions run through Vercel API routes so the Notion token is not exposed in the front end.

## Disclaimer

This is an unofficial fan-made collection tool. Magic: The Gathering and related card names, images, symbols and artwork are property of Wizards of the Coast. This app is not affiliated with, endorsed, sponsored or approved by Wizards of the Coast.
