Arcane Binder code cleanup patch

Replace:
/src/App.tsx
/src/styles.css
/package.json
/api/cards.js

Purpose:
- Removes the experimental camera scanner and tesseract.js dependency.
- Keeps the app focused on Notion library access, manual add, scanner-app export import, and 100-card deck lists.
- Keeps quantity logic clean: Total Quantity = Foil Quantity + Non-Foil Quantity.
- Keeps saved deck viewing/copying.

No Notion database changes are required.
