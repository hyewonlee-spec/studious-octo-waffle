Arcane Binder — Delver CSV Import + Compact Visual Patch

Replace these files:
/src/App.tsx
/src/styles.css
/src/lib/scryfall.ts
/tsconfig.json

What changed:
- Tightened vertical spacing across the app.
- Reduced hero height, panel padding, form gaps, card/list spacing and textarea height.
- Added Delver CSV auto-detection.
- Added Delver CSV parsing for the uploaded sample columns:
  Artist, Mana Cost, Creation Date, Foil/Etched, Foil, Mana Value, Card Name, Number, Rules Text, Rarity, Type Line, Creature Power, Creature Toughness, List Name, Scryfall Id
- Uses Scryfall ID from Delver CSV to retrieve the exact card/printing.
- Preserves Delver metadata in Notes where possible: list name, creation date, rarity, type, mana cost and mana value.
- Groups duplicate CSV rows into quantity counts.
- Keeps foil/non-foil split based on Delver foil columns.

Build check:
npm run build completed successfully.
