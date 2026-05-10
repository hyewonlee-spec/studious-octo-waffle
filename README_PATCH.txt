Arcane Binder text file import patch

Replace these files in your GitHub repo:

1. /src/App.tsx
2. /src/styles.css
3. /tsconfig.json

What this adds:
- Add Card now has two modes: Single card and Text file import.
- Text file import accepts uploaded .txt/.csv files or pasted card lists.
- Accepted examples:
  1 Sol Ring
  2x Counterspell
  1 Arcane Signet [CMM] #648
  1 Command Tower (LTC) 350 foil
- The app parses the list, matches cards through Scryfall, previews matches, then saves matched cards to your Notion Owned Cards database.
- Default import language and default foil/non-foil can be selected before saving.

Notes:
- If the text list does not include set/collector details, the app chooses the first Scryfall print match.
- Unmatched lines are not saved. Add those manually through Single card search.
- Import creates new card records; it does not merge with existing Notion rows yet.
