Arcane Binder quantity counting fix

Replace these files in your GitHub repository:

/src/App.tsx
/api/cards.js

What changed:
- The app now treats Total Quantity as a calculated value only.
- Total is calculated from Foil Quantity + Non-Foil Quantity.
- The frontend no longer sends Total Quantity as an independent value when adding/importing/editing cards.
- The API no longer writes Total Quantity to Notion.
- The API returns totalQuantity by deriving it from Foil Quantity + Non-Foil Quantity.
- If an old row has no foil/non-foil split, the API can still fall back to the old Total Quantity value.

Recommended Notion update:
- Change Total Quantity from Number to Formula if you want to keep seeing it in Notion.
- Formula: prop("Foil Quantity") + prop("Non-Foil Quantity")

If Notion does not allow converting the existing Total Quantity property cleanly, create a new Formula property called Calculated Total instead and use the formula above.
