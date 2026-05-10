Arcane Binder — Real Scanner Mechanics Patch

Replace:
/src/App.tsx
/src/styles.css

Only replace /package.json if your current package.json does not already include:
"tesseract.js": "^7.0.0"

What changed:
- Camera scan no longer treats the whole card as plain text.
- It crops the MTG title-bar and upper-card zones.
- It runs multiple OCR preprocessing variants.
- It ranks card-name candidates.
- It checks Scryfall exact, fuzzy, autocomplete, and regular search.
- It automatically searches through multiple candidates until it finds a Scryfall match.

Run:
npm install
npm run build
