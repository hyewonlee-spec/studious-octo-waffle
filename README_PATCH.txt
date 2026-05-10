Camera OCR correction patch

Replace:
- /src/App.tsx
- /src/styles.css
- /package.json only if your repo does not already include tesseract.js

This patch adds a manual correction field to Camera scan. If OCR reads the wrong text, type the card name (for example, Coiling Oracle) and search Scryfall. It also scans multiple top crops of the photo to improve title detection.
