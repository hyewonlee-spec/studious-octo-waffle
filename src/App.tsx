import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import type { DeckList, OwnedCard, ScryfallCard } from './types';
import { getCardImage, getScryfallCardById, labelLanguage, searchScryfallCards } from './lib/scryfall';

type Tab = 'library' | 'add' | 'decks' | 'settings';
type AddMode = 'single' | 'import';
type Notice = { type: 'success' | 'error' | 'info'; message: string };
type ImportFoilMode = 'nonfoil' | 'foil';
type ImportProfile = 'auto' | 'delver' | 'plain';

type ParsedImportCard = {
  key: string;
  originalLine: string;
  name: string;
  quantity: number;
  setCode?: string;
  collectorNumber?: string;
  scryfallId?: string;
  foilHint?: boolean;
  foilQuantity?: number;
  nonfoilQuantity?: number;
  language?: string;
  noteDetails?: string[];
  source?: 'delver' | 'text';
};

type MatchedImportCard = ParsedImportCard & {
  status: 'pending' | 'matched' | 'not-found' | 'error';
  matchedCard?: ScryfallCard;
  error?: string;
};

const languageOptions = [
  'English',
  'Japanese',
  'Korean',
  'Chinese Simplified',
  'Chinese Traditional',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Russian',
  'Spanish',
  'Other',
];

const deckListHeadings = new Set([
  'commander',
  'commanders',
  'companion',
  'creature',
  'creatures',
  'instant',
  'instants',
  'sorcery',
  'sorceries',
  'artifact',
  'artifacts',
  'enchantment',
  'enchantments',
  'planeswalker',
  'planeswalkers',
  'land',
  'lands',
  'sideboard',
  'maybeboard',
  'tokens',
  'deck',
  'mainboard',
  'main deck',
]);

const emptyNewCard = {
  nonfoilQuantity: 1,
  foilQuantity: 0,
  language: 'English',
  notes: '',
};

function apiErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

async function readApiError(response: Response) {
  const data = await response.json().catch(() => ({}));
  return data.error || `Request failed with ${response.status}.`;
}

function getOwnedCardTotal(card: Pick<OwnedCard, 'foilQuantity' | 'nonfoilQuantity' | 'totalQuantity'>) {
  const foilQuantity = Math.max(0, Number(card.foilQuantity || 0));
  const nonfoilQuantity = Math.max(0, Number(card.nonfoilQuantity || 0));
  const splitTotal = foilQuantity + nonfoilQuantity;
  const storedTotal = Math.max(0, Number(card.totalQuantity || 0));
  return splitTotal > 0 ? splitTotal : storedTotal;
}

function normaliseImportLine(line: string) {
  return line.trim().replace(/^[-*•]\s+/, '').replace(/^SB:\s*/i, '').replace(/^Sideboard:\s*/i, '').replace(/\s+/g, ' ');
}

function isHeadingLine(line: string) {
  return deckListHeadings.has(line.toLowerCase().replace(/[:\-]+$/g, '').trim());
}

function cleanImportedCardName(rawName: string) {
  let working = rawName.trim();
  const foilHint = /(?:\bfoil\b|\*f\*|\[f\])/i.test(working);

  working = working
    .replace(/\*f\*/gi, '')
    .replace(/\[f\]/gi, '')
    .replace(/\[foil\]/gi, '')
    .replace(/\(foil\)/gi, '')
    .replace(/\bfoil\b/gi, '')
    .trim();

  let setCode: string | undefined;
  let collectorNumber: string | undefined;

  const bracketMatch = working.match(/\[([A-Za-z0-9]{2,8})\](?:\s*#?([A-Za-z0-9★☆-]+))?\s*$/);
  if (bracketMatch) {
    setCode = bracketMatch[1].toUpperCase();
    collectorNumber = bracketMatch[2];
    working = working.slice(0, bracketMatch.index).trim();
  }

  const parenthesisMatch = working.match(/\(([A-Za-z0-9]{2,8})\)(?:\s*#?([A-Za-z0-9★☆-]+))?\s*$/);
  if (!setCode && parenthesisMatch) {
    setCode = parenthesisMatch[1].toUpperCase();
    collectorNumber = parenthesisMatch[2];
    working = working.slice(0, parenthesisMatch.index).trim();
  }

  return { name: working.replace(/\s+/g, ' ').trim(), setCode, collectorNumber, foilHint };
}


function normaliseCsvHeader(header: string) {
  return header.trim().toLowerCase().replace(/[\s_/-]+/g, '');
}

function readCsvValue(row: Record<string, string>, names: string[]) {
  for (const name of names) {
    const key = Object.keys(row).find((header) => normaliseCsvHeader(header) === normaliseCsvHeader(name));
    if (key && row[key] !== undefined) return row[key].trim();
  }
  return '';
}

function parseCsvRows(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  if (rows.length < 2) return [];

  const headers = rows[0].map((cell) => cell.trim());
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] || '').trim();
    });
    return record;
  });
}

function looksLikeDelverCsv(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const headers = firstLine.split(',').map(normaliseCsvHeader);
  return headers.includes('cardname') && (headers.includes('scryfallid') || headers.includes('listname') || headers.includes('foil'));
}

function parseQuantityValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function isFoilValue(value: string) {
  return /foil|etched|true|yes|1/i.test(value || '');
}

function parseDelverCsvText(text: string): ParsedImportCard[] {
  const records = parseCsvRows(text);
  const byKey = new Map<string, ParsedImportCard>();

  records.forEach((row, index) => {
    const name = readCsvValue(row, ['Card Name', 'Name', 'Card']);
    if (!name) return;

    const scryfallId = readCsvValue(row, ['Scryfall Id', 'Scryfall ID', 'ScryfallId']);
    const collectorNumber = readCsvValue(row, ['Number', 'Collector Number', 'Collector No']);
    const quantity = parseQuantityValue(readCsvValue(row, ['Quantity', 'Qty', 'Count']));
    const foilText = [readCsvValue(row, ['Foil']), readCsvValue(row, ['Foil/Etched']), readCsvValue(row, ['Finish'])].filter(Boolean).join(' ');
    const foilHint = isFoilValue(foilText);
    const language = readCsvValue(row, ['Language', 'Lang']);
    const listName = readCsvValue(row, ['List Name', 'List']);
    const creationDate = readCsvValue(row, ['Creation Date', 'Created At', 'Date']);
    const rarity = readCsvValue(row, ['Rarity']);
    const typeLine = readCsvValue(row, ['Type Line', 'Type']);
    const manaCost = readCsvValue(row, ['Mana Cost']);
    const manaValue = readCsvValue(row, ['Mana Value', 'CMC']);

    const noteDetails = [
      'Imported from Delver CSV',
      listName ? `Delver list: ${listName}` : '',
      creationDate ? `Delver created: ${creationDate}` : '',
      rarity ? `Rarity: ${rarity}` : '',
      typeLine ? `Type: ${typeLine}` : '',
      manaCost ? `Mana cost: ${manaCost}` : '',
      manaValue ? `Mana value: ${manaValue}` : '',
    ].filter(Boolean);

    const key = [scryfallId || name.toLowerCase(), collectorNumber, foilHint ? 'foil' : 'nonfoil', language || 'default'].join('|');
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.originalLine = `${existing.originalLine}; Delver row ${index + 2}`;
      existing.foilQuantity = (existing.foilQuantity || 0) + (foilHint ? quantity : 0);
      existing.nonfoilQuantity = (existing.nonfoilQuantity || 0) + (foilHint ? 0 : quantity);
      return;
    }

    byKey.set(key, {
      key: `${key}|${index}`,
      originalLine: `Delver row ${index + 2}: ${quantity} ${name}${foilHint ? ' foil' : ''}`,
      name,
      quantity,
      collectorNumber: collectorNumber || undefined,
      scryfallId: scryfallId || undefined,
      foilHint,
      foilQuantity: foilHint ? quantity : 0,
      nonfoilQuantity: foilHint ? 0 : quantity,
      language: language || undefined,
      noteDetails,
      source: 'delver',
    });
  });

  return Array.from(byKey.values()).slice(0, 500);
}

function parseCardListText(text: string, profile: ImportProfile = 'auto'): ParsedImportCard[] {
  if ((profile === 'auto' && looksLikeDelverCsv(text)) || profile === 'delver') {
    return parseDelverCsvText(text);
  }

  const byKey = new Map<string, ParsedImportCard>();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const originalLine = rawLine.trim();
    const line = normaliseImportLine(rawLine);
    if (!line || line.startsWith('#') || line.startsWith('//') || isHeadingLine(line)) return;

    let quantity = 1;
    let rawName = line;
    const leadingQuantity = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
    const trailingQuantity = line.match(/^(.+?)\s+[xX]\s*(\d+)$/i);

    if (leadingQuantity) {
      quantity = Number(leadingQuantity[1]);
      rawName = leadingQuantity[2];
    } else if (trailingQuantity) {
      quantity = Number(trailingQuantity[2]);
      rawName = trailingQuantity[1];
    }

    if (!Number.isFinite(quantity) || quantity <= 0) return;
    const cleaned = cleanImportedCardName(rawName);
    if (!cleaned.name || isHeadingLine(cleaned.name)) return;

    const key = [cleaned.name.toLowerCase(), cleaned.setCode || '', cleaned.collectorNumber || '', cleaned.foilHint ? 'foil' : 'default'].join('|');
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.originalLine = `${existing.originalLine}; ${originalLine}`;
      return;
    }

    byKey.set(key, {
      key: `${key}|${index}`,
      originalLine,
      name: cleaned.name,
      quantity,
      setCode: cleaned.setCode,
      collectorNumber: cleaned.collectorNumber,
      foilHint: cleaned.foilHint,
      source: 'text',
    });
  });

  return Array.from(byKey.values()).slice(0, 250);
}

function escapeScryfallExactName(name: string) {
  return name.replace(/"/g, '\\"');
}

async function findScryfallCardForImport(item: ParsedImportCard) {
  if (item.scryfallId) {
    return getScryfallCardById(item.scryfallId);
  }

  const exactName = `!"${escapeScryfallExactName(item.name)}"`;
  const queries = item.setCode ? [`${exactName} set:${item.setCode}`, `${item.name} set:${item.setCode}`, item.name] : [exactName, item.name];
  let lastError = 'No matching card found.';

  for (const query of queries) {
    try {
      const results = await searchScryfallCards(query);
      const exactMatches = results.filter((card) => card.name.toLowerCase() === item.name.toLowerCase());
      const pool = exactMatches.length ? exactMatches : results;
      const collectorMatch = item.collectorNumber ? pool.find((card) => card.collector_number.toLowerCase() === item.collectorNumber?.toLowerCase()) : undefined;
      const setMatch = item.setCode ? pool.find((card) => card.set.toUpperCase() === item.setCode) : undefined;
      const matched = collectorMatch || setMatch || pool[0];
      if (matched) return matched;
    } catch (error) {
      lastError = apiErrorMessage(error);
    }
  }

  throw new Error(lastError);
}

function makeImportNote(existingNote: string, originalLine: string, details: string[] = []) {
  const detailText = details.length ? `\n${details.join('\n')}` : '';
  const stamp = `Imported from scanner/export list: ${originalLine}${detailText}`;
  return existingNote.trim() ? `${existingNote.trim()}\n${stamp}` : stamp;
}

function makeDeckText(entries: Record<string, number>) {
  return Object.entries(entries)
    .filter(([, quantity]) => quantity > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, quantity]) => `${quantity} ${name}`)
    .join('\n');
}

function getDeckCount(entries: Record<string, number>) {
  return Object.values(entries).reduce((sum, quantity) => sum + quantity, 0);
}

function uniqueValues(cards: OwnedCard[], getter: (card: OwnedCard) => string) {
  return Array.from(new Set(cards.map(getter).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('library');
  const [cards, setCards] = useState<OwnedCard[]>([]);
  const [decks, setDecks] = useState<DeckList[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [librarySearch, setLibrarySearch] = useState('');
  const [setFilter, setSetFilter] = useState('all');
  const [foilFilter, setFoilFilter] = useState('all');
  const [languageFilter, setLanguageFilter] = useState('all');
  const [quantityFilter, setQuantityFilter] = useState('all');

  const [addMode, setAddMode] = useState<AddMode>('single');
  const [cardSearch, setCardSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ScryfallCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(null);
  const [newCard, setNewCard] = useState(emptyNewCard);
  const [savingCard, setSavingCard] = useState(false);

  const [importText, setImportText] = useState('');
  const [importProfile, setImportProfile] = useState<ImportProfile>('auto');
  const [importLanguage, setImportLanguage] = useState('English');
  const [importFoilMode, setImportFoilMode] = useState<ImportFoilMode>('nonfoil');
  const [matchedImports, setMatchedImports] = useState<MatchedImportCard[]>([]);
  const [matchingImports, setMatchingImports] = useState(false);
  const [savingImports, setSavingImports] = useState(false);

  const [editingCard, setEditingCard] = useState<OwnedCard | null>(null);
  const [editDraft, setEditDraft] = useState(emptyNewCard);
  const [savingEdit, setSavingEdit] = useState(false);

  const [deckName, setDeckName] = useState('');
  const [deckNotes, setDeckNotes] = useState('');
  const [deckEntries, setDeckEntries] = useState<Record<string, number>>({});
  const [savingDeck, setSavingDeck] = useState(false);
  const [viewingDeck, setViewingDeck] = useState<DeckList | null>(null);

  const showNotice = (type: Notice['type'], message: string) => {
    setNotice({ type, message });
    window.setTimeout(() => setNotice(null), 5000);
  };

  async function loadCards() {
    setLoadingCards(true);
    try {
      const response = await fetch('/api/cards');
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json();
      setCards(data.cards || []);
    } catch (error) {
      showNotice('error', apiErrorMessage(error));
    } finally {
      setLoadingCards(false);
    }
  }

  async function loadDecks() {
    setLoadingDecks(true);
    try {
      const response = await fetch('/api/decks');
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json();
      setDecks(data.decks || []);
    } catch (error) {
      showNotice('error', apiErrorMessage(error));
    } finally {
      setLoadingDecks(false);
    }
  }

  useEffect(() => {
    loadCards();
    loadDecks();
  }, []);

  const setOptions = useMemo(() => uniqueValues(cards, (card) => card.setCode), [cards]);
  const languageFilterOptions = useMemo(() => uniqueValues(cards, (card) => String(card.language || '')), [cards]);

  const filteredCards = useMemo(() => {
    const search = librarySearch.trim().toLowerCase();
    return cards.filter((card) => {
      const total = getOwnedCardTotal(card);
      const matchesSearch = !search || card.name.toLowerCase().includes(search) || card.setName.toLowerCase().includes(search) || card.setCode.toLowerCase().includes(search);
      const matchesSet = setFilter === 'all' || card.setCode === setFilter;
      const matchesFoil = foilFilter === 'all' || (foilFilter === 'foil' ? card.foilQuantity > 0 : card.nonfoilQuantity > 0);
      const matchesLanguage = languageFilter === 'all' || card.language === languageFilter;
      const matchesQuantity = quantityFilter === 'all' || (quantityFilter === 'one' ? total === 1 : quantityFilter === 'twoPlus' ? total >= 2 : total >= 4);
      return matchesSearch && matchesSet && matchesFoil && matchesLanguage && matchesQuantity;
    });
  }, [cards, librarySearch, setFilter, foilFilter, languageFilter, quantityFilter]);

  const deckCount = getDeckCount(deckEntries);
  const deckText = makeDeckText(deckEntries);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSelectedCard(null);
    try {
      const results = await searchScryfallCards(cardSearch);
      setSearchResults(results.slice(0, 30));
      if (!results.length) showNotice('info', 'No cards found. Try a different card name.');
    } catch (error) {
      showNotice('error', apiErrorMessage(error));
    } finally {
      setSearching(false);
    }
  }

  function selectCard(card: ScryfallCard) {
    setSelectedCard(card);
    setNewCard({ nonfoilQuantity: card.nonfoil ? 1 : 0, foilQuantity: card.nonfoil ? 0 : 1, language: labelLanguage(card.lang), notes: '' });
  }

  async function saveOwnedCard(payload: Omit<OwnedCard, 'id'> & { id?: string }) {
    const response = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await readApiError(response));
    return response.json();
  }

  async function handleSaveCard(event: FormEvent) {
    event.preventDefault();
    if (!selectedCard) return;
    const foilQuantity = Math.max(0, Number(newCard.foilQuantity || 0));
    const nonfoilQuantity = Math.max(0, Number(newCard.nonfoilQuantity || 0));
    if (foilQuantity + nonfoilQuantity <= 0) {
      showNotice('error', 'Add at least one foil or non-foil copy.');
      return;
    }

    setSavingCard(true);
    try {
      await saveOwnedCard({
        scryfallId: selectedCard.id,
        name: selectedCard.name,
        setName: selectedCard.set_name,
        setCode: selectedCard.set.toUpperCase(),
        collectorNumber: selectedCard.collector_number,
        imageUrl: getCardImage(selectedCard),
        totalQuantity: foilQuantity + nonfoilQuantity,
        foilQuantity,
        nonfoilQuantity,
        language: newCard.language,
        notes: newCard.notes,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      showNotice('success', `${selectedCard.name} saved to your library.`);
      setSelectedCard(null);
      setSearchResults([]);
      setCardSearch('');
      setNewCard(emptyNewCard);
      await loadCards();
    } catch (error) {
      showNotice('error', apiErrorMessage(error));
    } finally {
      setSavingCard(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportText(await file.text());
    event.target.value = '';
  }

  async function matchImportList() {
    const parsed = parseCardListText(importText, importProfile);
    if (!parsed.length) {
      showNotice('error', 'No card lines were found. Try lines like "1 Sol Ring" or "2x Counterspell".');
      return;
    }

    setMatchingImports(true);
    setMatchedImports(parsed.map((item) => ({ ...item, status: 'pending' })));

    const matched: MatchedImportCard[] = [];
    for (const item of parsed) {
      try {
        const card = await findScryfallCardForImport(item);
        matched.push({ ...item, status: 'matched', matchedCard: card });
      } catch (error) {
        matched.push({ ...item, status: 'not-found', error: apiErrorMessage(error) });
      }
      setMatchedImports([...matched, ...parsed.slice(matched.length).map((pending) => ({ ...pending, status: 'pending' as const }))]);
    }

    setMatchedImports(matched);
    setMatchingImports(false);
    const matchedCount = matched.filter((item) => item.status === 'matched').length;
    showNotice(matchedCount ? 'success' : 'error', `${matchedCount} of ${parsed.length} cards matched.`);
  }

  async function saveMatchedImports() {
    const items = matchedImports.filter((item) => item.status === 'matched' && item.matchedCard);
    if (!items.length) {
      showNotice('error', 'There are no matched cards to save.');
      return;
    }

    setSavingImports(true);
    try {
      for (const item of items) {
        const card = item.matchedCard!;
        const hasPreciseSplit = typeof item.foilQuantity === 'number' || typeof item.nonfoilQuantity === 'number';
        const shouldFoil = item.foilHint || importFoilMode === 'foil';
        const foilQuantity = hasPreciseSplit ? Math.max(0, Number(item.foilQuantity || 0)) : shouldFoil ? item.quantity : 0;
        const nonfoilQuantity = hasPreciseSplit ? Math.max(0, Number(item.nonfoilQuantity || 0)) : shouldFoil ? 0 : item.quantity;
        await saveOwnedCard({
          scryfallId: card.id,
          name: card.name,
          setName: card.set_name,
          setCode: card.set.toUpperCase(),
          collectorNumber: card.collector_number,
          imageUrl: getCardImage(card),
          totalQuantity: foilQuantity + nonfoilQuantity,
          foilQuantity,
          nonfoilQuantity,
          language: item.language || importLanguage,
          notes: makeImportNote('', item.originalLine, item.noteDetails),
          addedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      showNotice('success', `${items.length} imported cards saved to Notion.`);
      setImportText('');
      setMatchedImports([]);
      await loadCards();
      setActiveTab('library');
    } catch (error) {
      showNotice('error', apiErrorMessage(error));
    } finally {
      setSavingImports(false);
    }
  }

  function openEdit(card: OwnedCard) {
    setEditingCard(card);
    setEditDraft({ nonfoilQuantity: card.nonfoilQuantity, foilQuantity: card.foilQuantity, language: String(card.language || 'English'), notes: card.notes || '' });
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingCard) return;
    const foilQuantity = Math.max(0, Number(editDraft.foilQuantity || 0));
    const nonfoilQuantity = Math.max(0, Number(editDraft.nonfoilQuantity || 0));
    if (foilQuantity + nonfoilQuantity <= 0) {
      showNotice('error', 'Quantity cannot be zero. Delete the card instead if you no longer own it.');
      return;
    }

    setSavingEdit(true);
    try {
      const response = await fetch(`/api/cards?pageId=${encodeURIComponent(editingCard.pageId || editingCard.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editingCard, ...editDraft, totalQuantity: foilQuantity + nonfoilQuantity, foilQuantity, nonfoilQuantity }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setEditingCard(null);
      showNotice('success', 'Card updated.');
      await loadCards();
    } catch (error) {
      showNotice('error', apiErrorMessage(error));
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteCard(card: OwnedCard) {
    const response = await fetch(`/api/cards?pageId=${encodeURIComponent(card.pageId || card.id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await readApiError(response));
    showNotice('success', 'Card deleted.');
    await loadCards();
  }

  function addCardToDeck(card: OwnedCard) {
    const nextTotal = deckCount + 1;
    if (nextTotal > 100) {
      showNotice('error', 'A 100-card deck cannot go over 100 cards.');
      return;
    }
    setDeckEntries((current) => ({ ...current, [card.name]: (current[card.name] || 0) + 1 }));
  }

  function removeDeckEntry(name: string) {
    setDeckEntries((current) => {
      const next = { ...current };
      if ((next[name] || 0) <= 1) delete next[name];
      else next[name] -= 1;
      return next;
    });
  }

  async function copyDeckText(text = deckText) {
    await navigator.clipboard.writeText(text);
    showNotice('success', 'Deck list copied.');
  }

  async function saveDeck(event: FormEvent) {
    event.preventDefault();
    if (!deckName.trim()) {
      showNotice('error', 'Give the deck a name before saving.');
      return;
    }
    if (!deckCount) {
      showNotice('error', 'Add at least one card before saving a deck list.');
      return;
    }

    setSavingDeck(true);
    try {
      const response = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckName, deckText, cardCount: deckCount, notes: deckNotes, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      showNotice('success', 'Deck list saved to Notion.');
      setDeckName('');
      setDeckNotes('');
      setDeckEntries({});
      await loadDecks();
    } catch (error) {
      showNotice('error', apiErrorMessage(error));
    } finally {
      setSavingDeck(false);
    }
  }

  async function deleteDeck(deck: DeckList) {
    const response = await fetch(`/api/decks?pageId=${encodeURIComponent(deck.pageId || deck.id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await readApiError(response));
    showNotice('success', 'Deck list deleted.');
    await loadDecks();
  }

  return (
    <main className="app-shell">
      <header className="hero-card">
        <p className="eyebrow">Arcane Binder</p>
        <h1>MTG card library</h1>
        <p>Use scanner-app exports as the input, then manage your Notion library and 100-card deck lists here.</p>
      </header>

      {notice && <section className={`notice notice--${notice.type}`}>{notice.message}</section>}

      <nav className="tab-bar" aria-label="Primary navigation">
        <button className={activeTab === 'library' ? 'active' : ''} onClick={() => setActiveTab('library')}>Library</button>
        <button className={activeTab === 'add' ? 'active' : ''} onClick={() => setActiveTab('add')}>Add Card</button>
        <button className={activeTab === 'decks' ? 'active' : ''} onClick={() => setActiveTab('decks')}>100 Card Deck</button>
        <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>Settings</button>
      </nav>

      {activeTab === 'library' && (
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Owned cards</p>
              <h2>Library</h2>
            </div>
            <button className="secondary-button" onClick={loadCards} disabled={loadingCards}>{loadingCards ? 'Refreshing…' : 'Refresh'}</button>
          </div>

          <div className="filter-grid">
            <label>Search<input value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="Card, set, code" /></label>
            <label>Set<select value={setFilter} onChange={(event) => setSetFilter(event.target.value)}><option value="all">All sets</option>{setOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Foil<select value={foilFilter} onChange={(event) => setFoilFilter(event.target.value)}><option value="all">All</option><option value="foil">Foil owned</option><option value="nonfoil">Non-foil owned</option></select></label>
            <label>Language<select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)}><option value="all">All languages</option>{languageFilterOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label>Quantity<select value={quantityFilter} onChange={(event) => setQuantityFilter(event.target.value)}><option value="all">All quantities</option><option value="one">1 copy</option><option value="twoPlus">2+ copies</option><option value="fourPlus">4+ copies</option></select></label>
          </div>

          <div className="summary-strip"><strong>{filteredCards.length}</strong> shown · <strong>{cards.length}</strong> total records</div>

          <div className="card-grid">
            {filteredCards.map((card) => (
              <article className="owned-card" key={card.id}>
                {card.imageUrl ? <img src={card.imageUrl} alt={card.name} /> : <div className="image-placeholder">No image</div>}
                <div className="owned-card__body">
                  <h3>{card.name}</h3>
                  <p>{card.setName} · {card.setCode} #{card.collectorNumber}</p>
                  <div className="mini-stats"><span>Total {getOwnedCardTotal(card)}</span><span>Foil {card.foilQuantity}</span><span>Non-foil {card.nonfoilQuantity}</span><span>{card.language}</span></div>
                  {card.notes && <p className="card-notes">{card.notes}</p>}
                  <div className="button-row"><button className="secondary-button" onClick={() => openEdit(card)}>Edit</button><button className="danger-button" onClick={() => deleteCard(card).catch((error) => showNotice('error', apiErrorMessage(error)))}>Delete</button></div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'add' && (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">Add cards</p><h2>Add to library</h2></div></div>
          <div className="mode-switch"><button className={addMode === 'single' ? 'active' : ''} onClick={() => setAddMode('single')}>Single card</button><button className={addMode === 'import' ? 'active' : ''} onClick={() => setAddMode('import')}>Import list</button></div>

          {addMode === 'single' ? (
            <div className="two-column">
              <section className="sub-panel">
                <h3>Search Scryfall</h3>
                <form onSubmit={handleSearch} className="stacked-form"><input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Sol Ring" /><button type="submit" disabled={searching}>{searching ? 'Searching…' : 'Search'}</button></form>
                <div className="result-list">{searchResults.map((card) => <button key={card.id} className="result-row" onClick={() => selectCard(card)}><span>{card.name}</span><small>{card.set_name} · {card.set.toUpperCase()} #{card.collector_number}</small></button>)}</div>
              </section>
              <section className="sub-panel">
                <h3>Selected printing</h3>
                {selectedCard ? <CardSaveForm card={selectedCard} draft={newCard} setDraft={setNewCard} saving={savingCard} onSubmit={handleSaveCard} /> : <p className="muted">Search and select a card printing first.</p>}
              </section>
            </div>
          ) : (
            <section className="sub-panel">
              <h3>Import from third-party scanner app</h3>
              <p className="muted compact-copy">Upload a Delver Lens CSV or paste a clipboard/plain text list. Delver CSV imports use Scryfall ID, foil status, list name, creation date and collector number when available.</p>
              <div className="filter-grid">
                <label>Import profile<select value={importProfile} onChange={(event) => setImportProfile(event.target.value as ImportProfile)}><option value="auto">Auto-detect</option><option value="delver">Delver CSV</option><option value="plain">Plain text / clipboard</option></select></label>
                <label>Default language<select value={importLanguage} onChange={(event) => setImportLanguage(event.target.value)}>{languageOptions.map((language) => <option key={language} value={language}>{language}</option>)}</select></label>
                <label>Default quantity type<select value={importFoilMode} onChange={(event) => setImportFoilMode(event.target.value as ImportFoilMode)}><option value="nonfoil">Non-foil</option><option value="foil">Foil</option></select></label>
                <label>Upload Delver CSV/text<input type="file" accept=".txt,.csv" onChange={handleImportFile} /></label>
              </div>
              <textarea className="import-box" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'Delver CSV: upload the exported .csv file\n\nPlain text examples:\n1 Sol Ring\n2x Counterspell\n1 Command Tower (LTC) 350 foil'} />
              <div className="button-row"><button onClick={matchImportList} disabled={matchingImports}>{matchingImports ? 'Matching…' : 'Parse and match'}</button><button className="secondary-button" onClick={() => { setImportText(''); setMatchedImports([]); }}>Clear</button></div>
              {matchedImports.length > 0 && <ImportPreview items={matchedImports} saving={savingImports} onSave={saveMatchedImports} />}
            </section>
          )}
        </section>
      )}

      {activeTab === 'decks' && (
        <section className="panel">
          <div className="section-heading"><div><p className="eyebrow">100-card lists</p><h2>Deck builder</h2></div><button className="secondary-button" onClick={loadDecks} disabled={loadingDecks}>{loadingDecks ? 'Refreshing…' : 'Refresh decks'}</button></div>
          <form className="deck-layout" onSubmit={saveDeck}>
            <section className="sub-panel">
              <h3>Deck details</h3>
              <label>Deck name<input value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder="Simic Value" /></label>
              <label>Notes<textarea value={deckNotes} onChange={(event) => setDeckNotes(event.target.value)} placeholder="Commander, theme, upgrade notes" /></label>
              <div className="deck-counter"><strong>{deckCount}</strong> / 100 cards</div>
              <textarea className="deck-text" value={deckText} readOnly placeholder="Deck text appears here." />
              <div className="button-row"><button type="button" className="secondary-button" onClick={() => copyDeckText()} disabled={!deckText}>Copy deck list</button><button type="submit" disabled={savingDeck}>{savingDeck ? 'Saving…' : 'Save deck'}</button></div>
            </section>
            <section className="sub-panel">
              <h3>Add from library</h3>
              <div className="compact-list">{cards.map((card) => <button type="button" key={card.id} className="compact-row" onClick={() => addCardToDeck(card)}><span>{card.name}</span><small>{card.setCode} · owned {getOwnedCardTotal(card)}</small></button>)}</div>
            </section>
            <section className="sub-panel">
              <h3>Current list</h3>
              <div className="compact-list">{Object.entries(deckEntries).map(([name, quantity]) => <div key={name} className="compact-row compact-row--static"><span>{quantity} {name}</span><button type="button" className="tiny-button" onClick={() => removeDeckEntry(name)}>Remove 1</button></div>)}</div>
            </section>
          </form>

          <section className="sub-panel spaced">
            <h3>Saved Notion decks</h3>
            <div className="compact-list">{decks.map((deck) => <div className="compact-row compact-row--static" key={deck.id}><span><strong>{deck.deckName}</strong><small>{deck.cardCount} cards</small></span><div className="button-row"><button className="tiny-button" onClick={() => setViewingDeck(deck)}>View</button><button className="tiny-button" onClick={() => copyDeckText(deck.deckText)}>Copy</button><button className="tiny-button danger" onClick={() => deleteDeck(deck).catch((error) => showNotice('error', apiErrorMessage(error)))}>Delete</button></div></div>)}</div>
          </section>
        </section>
      )}

      {activeTab === 'settings' && (
        <section className="panel">
          <p className="eyebrow">Setup</p>
          <h2>Settings</h2>
          <div className="settings-grid">
            <div className="sub-panel"><h3>Data source</h3><p>Scryfall is used for card search, images, sets and exact printings.</p></div>
            <div className="sub-panel"><h3>Storage</h3><p>Your owned cards and deck lists are stored in your connected Notion databases through Vercel API routes.</p></div>
            <div className="sub-panel"><h3>Scanner strategy</h3><p>Use ManaBox, Delver Lens or another MTG scanner app to scan physical cards, then import the exported text or CSV into this app.</p></div>
          </div>
          <p className="disclaimer">This is an unofficial fan-made collection tool. Magic: The Gathering and related card images, names, symbols and artwork are property of Wizards of the Coast. This app is not affiliated with, endorsed, sponsored or approved by Wizards of the Coast.</p>
        </section>
      )}

      {editingCard && (
        <div className="modal-backdrop" onClick={() => setEditingCard(null)}>
          <form className="modal-card" onSubmit={saveEdit} onClick={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">Edit card</p><h2>{editingCard.name}</h2></div><button type="button" className="icon-button" onClick={() => setEditingCard(null)}>×</button></div>
            <QuantityFields draft={editDraft} setDraft={setEditDraft} />
            <label>Language<select value={editDraft.language} onChange={(event) => setEditDraft((draft) => ({ ...draft, language: event.target.value }))}>{languageOptions.map((language) => <option key={language} value={language}>{language}</option>)}</select></label>
            <label>Notes<textarea value={editDraft.notes} onChange={(event) => setEditDraft((draft) => ({ ...draft, notes: event.target.value }))} /></label>
            <button type="submit" disabled={savingEdit}>{savingEdit ? 'Saving…' : 'Save changes'}</button>
          </form>
        </div>
      )}

      {viewingDeck && (
        <div className="modal-backdrop" onClick={() => setViewingDeck(null)}>
          <section className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section-heading"><div><p className="eyebrow">Saved deck</p><h2>{viewingDeck.deckName}</h2></div><button type="button" className="icon-button" onClick={() => setViewingDeck(null)}>×</button></div>
            <p className="muted">{viewingDeck.cardCount} cards{viewingDeck.updatedAt ? ` · Updated ${viewingDeck.updatedAt}` : ''}</p>
            {viewingDeck.notes && <p>{viewingDeck.notes}</p>}
            <textarea className="deck-text" value={viewingDeck.deckText} readOnly />
            <button onClick={() => copyDeckText(viewingDeck.deckText)}>Copy deck list</button>
          </section>
        </div>
      )}
    </main>
  );
}

type Draft = typeof emptyNewCard;

function QuantityFields({ draft, setDraft }: { draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>> }) {
  const total = Math.max(0, Number(draft.foilQuantity || 0)) + Math.max(0, Number(draft.nonfoilQuantity || 0));
  return (
    <div className="quantity-grid">
      <label>Non-foil quantity<input type="number" min="0" value={draft.nonfoilQuantity} onChange={(event) => setDraft((current) => ({ ...current, nonfoilQuantity: Number(event.target.value) }))} /></label>
      <label>Foil quantity<input type="number" min="0" value={draft.foilQuantity} onChange={(event) => setDraft((current) => ({ ...current, foilQuantity: Number(event.target.value) }))} /></label>
      <div className="computed-total"><span>Calculated total</span><strong>{total}</strong></div>
    </div>
  );
}

function CardSaveForm({ card, draft, setDraft, saving, onSubmit }: { card: ScryfallCard; draft: Draft; setDraft: React.Dispatch<React.SetStateAction<Draft>>; saving: boolean; onSubmit: (event: FormEvent) => void }) {
  return (
    <form className="stacked-form" onSubmit={onSubmit}>
      <div className="selected-card-row">{getCardImage(card) && <img src={getCardImage(card)} alt={card.name} />}<div><h4>{card.name}</h4><p>{card.set_name} · {card.set.toUpperCase()} #{card.collector_number}</p></div></div>
      <QuantityFields draft={draft} setDraft={setDraft} />
      <label>Language<select value={draft.language} onChange={(event) => setDraft((current) => ({ ...current, language: event.target.value }))}>{languageOptions.map((language) => <option key={language} value={language}>{language}</option>)}</select></label>
      <label>Notes<textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Personal notes" /></label>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save to library'}</button>
    </form>
  );
}

function ImportPreview({ items, saving, onSave }: { items: MatchedImportCard[]; saving: boolean; onSave: () => void }) {
  const matchedCount = items.filter((item) => item.status === 'matched').length;
  return (
    <div className="import-preview">
      <div className="section-heading"><div><p className="eyebrow">Import preview</p><h3>{matchedCount} / {items.length} matched</h3></div><button onClick={onSave} disabled={saving || matchedCount === 0}>{saving ? 'Saving…' : 'Save matched cards'}</button></div>
      <div className="compact-list">{items.map((item) => <div className={`compact-row compact-row--static import-status--${item.status}`} key={item.key}><span><strong>{item.quantity} {item.name}</strong><small>{item.status === 'matched' && item.matchedCard ? `${item.matchedCard.name} · ${item.matchedCard.set.toUpperCase()} #${item.matchedCard.collector_number}${item.scryfallId ? ' · Scryfall ID matched' : ''}${item.foilQuantity ? ` · foil ${item.foilQuantity}` : ''}${item.nonfoilQuantity ? ` · non-foil ${item.nonfoilQuantity}` : ''}` : item.error || item.status}</small></span><span className="status-pill">{item.status}</span></div>)}</div>
    </div>
  );
}
