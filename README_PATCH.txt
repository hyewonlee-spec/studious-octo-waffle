Arcane Binder camera scan patch

Replace these files:
- /src/App.tsx
- /src/styles.css
- /package.json

What changed:
- Adds Add Card > Camera scan.
- Lets phone users capture/upload a card photo.
- Runs browser OCR using tesseract.js.
- Suggests possible card names, searches Scryfall, lets you select exact printing, then saves to Notion using the existing card save flow.

After replacing package.json, redeploy through Vercel. Vercel will install the new tesseract.js dependency during build.
