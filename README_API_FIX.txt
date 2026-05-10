Arcane Binder API crash fix

Replace/add these files in your GitHub repo:

ADD:
/api/_notion.js
/api/cards.js
/api/decks.js
/api/health.js

DELETE the old TypeScript API files if they still exist:
/api/_notion.ts
/api/cards.ts
/api/decks.ts

Why:
The deployed API routes are crashing before returning JSON. These plain JavaScript Vercel functions avoid TypeScript API runtime issues and return useful JSON errors for Notion/environment problems.

After deploying, test:
https://your-app.vercel.app/api/health
https://your-app.vercel.app/api/cards
https://your-app.vercel.app/api/decks
