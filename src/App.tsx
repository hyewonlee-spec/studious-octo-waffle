import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import type { DeckList, OwnedCard, ScryfallCard } from './types';
import { getCardImage, labelLanguage, searchScryfallCards } from './lib/scryfall';

type Tab = 'library' | 'add' | 'decks' | 'settings';

type Notice = {
  type: 'success' | 'error' | 'info';
  message: string;
};


type ParsedCardImport = {
  key: string;
  originalLine: string;
  name: string;
  quantity: number;
  setCode?: string;
  collectorNumber?: string;
  foilHint?: boolean;
};

type MatchedCardImport = ParsedCardImport & {
  status: 'pending' | 'matched' | 'not-found' | 'error';
  matchedCard?: ScryfallCard;
  error?: string;
};

type ImportFoilMode = 'nonfoil' | 'foil';

type AddMode = 'single' | 'bulk' | 'camera';

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

const initialNewCard = {
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

function normaliseImportLine(line: string) {
  return line
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^SB:\s*/i, '')
    .replace(/^Sideboard:\s*/i, '')
    .replace(/\s+/g, ' ');
}

function isHeadingLine(line: string) {
  const normalised = line.toLowerCase().replace(/[:\-]+$/g, '').trim();
  return deckListHeadings.has(normalised);
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

  working = working
    .replace(/\s+#?[A-Za-z0-9★☆-]+\s*$/i, (match) => {
      if (setCode || collectorNumber) return '';
      return /^\s+#\d/.test(match) ? '' : match;
    })
    .replace(/\s+/g, ' ')
    .trim();

  return {
    name: working,
    setCode,
    collectorNumber,
    foilHint,
  };
}

function parseCardListText(text: string): ParsedCardImport[] {
  const byKey = new Map<string, ParsedCardImport>();

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

    const key = [
      cleaned.name.toLowerCase(),
      cleaned.setCode || '',
      cleaned.collectorNumber || '',
      cleaned.foilHint ? 'foil' : 'default',
    ].join('|');

    const existing = byKey.get(key);
    if (existing) {
      byKey.set(key, {
        ...existing,
        quantity: existing.quantity + quantity,
        originalLine: `${existing.originalLine}; ${originalLine}`,
      });
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
    });
  });

  return Array.from(byKey.values()).slice(0, 150);
}

function escapeScryfallExactName(name: string) {
  return name.replace(/"/g, '\\"');
}

async function findScryfallCardForImport(item: ParsedCardImport) {
  const exactName = `!"${escapeScryfallExactName(item.name)}"`;
  const queries = item.setCode
    ? [`${exactName} set:${item.setCode}`, `${item.name} set:${item.setCode}`, item.name]
    : [exactName, item.name];

  let lastError = 'No matching card found.';

  for (const query of queries) {
    try {
      const results = await searchScryfallCards(query);
      const exactMatches = results.filter((card) => card.name.toLowerCase() === item.name.toLowerCase());
      const pool = exactMatches.length > 0 ? exactMatches : results;
      const collectorMatch = item.collectorNumber
        ? pool.find((card) => card.collector_number.toLowerCase() === item.collectorNumber?.toLowerCase())
        : undefined;
      const setMatch = item.setCode
        ? pool.find((card) => card.set.toUpperCase() === item.setCode)
        : undefined;
      const matched = collectorMatch || setMatch || pool[0];
      if (matched) return matched;
    } catch (error) {
      lastError = apiErrorMessage(error);
    }
  }

  throw new Error(lastError);
}

function makeImportNote(existingNote: string, originalLine: string) {
  const importStamp = `Imported from text list: ${originalLine}`;
  return existingNote.trim() ? `${existingNote.trim()}\n${importStamp}` : importStamp;
}


function cleanCameraOcrLine(line: string) {
  return line
    .replace(/[{}()[\]<>]/g, ' ')
    .replace(/[|_~`“”]/g, ' ')
    .replace(/[^A-Za-z0-9,'’\-/:.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeNonTitleLine(line: string) {
  const lower = line.toLowerCase();
  if (line.length < 3 || line.length > 70) return true;
  if (/^\d+$/.test(line)) return true;
  if (/^\d+\s*\/\s*\d+$/.test(line)) return true;
  if (/^(common|uncommon|rare|mythic|legendary|basic|token)$/i.test(line)) return true;
  if (/\b(instant|sorcery|creature|artifact|enchantment|planeswalker|battle|land)\b\s*[—-]/i.test(line)) return true;
  if (/\b(illus|illustrated|wizards|coast|copyright|collector|number|power|toughness)\b/i.test(lower)) return true;
  if ((line.match(/\d/g) || []).length > Math.max(2, line.length / 3)) return true;
  return false;
}

function extractCameraCardCandidates(rawText: string) {
  const unique = new Set<string>();
  const candidates: string[] = [];

  rawText.split(/\r?\n/).forEach((line) => {
    const cleaned = cleanCameraOcrLine(line);
    if (!cleaned || looksLikeNonTitleLine(cleaned)) return;
    const key = cleaned.toLowerCase();
    if (unique.has(key)) return;
    unique.add(key);
    candidates.push(cleaned);
  });

  return candidates.slice(0, 8);
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The image could not be loaded.'));
    };
    image.src = url;
  });
}

async function prepareCameraImageForOcr(file: File, cropTopRatio: number, cropHeightRatio: number) {
  const image = await loadImageFromFile(file);
  const canvas = document.createElement('canvas');
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropY = Math.max(0, Math.floor(sourceHeight * cropTopRatio));
  const cropHeight = Math.min(sourceHeight - cropY, Math.floor(sourceHeight * cropHeightRatio));
  const scale = Math.max(2, 1600 / Math.max(1, sourceWidth));

  canvas.width = Math.floor(sourceWidth * scale);
  canvas.height = Math.floor(cropHeight * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image processing is not available in this browser.');

  context.drawImage(image, 0, cropY, sourceWidth, cropHeight, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const grey = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    const contrast = grey > 165 ? 255 : grey < 115 ? 0 : grey;
    data[index] = contrast;
    data[index + 1] = contrast;
    data[index + 2] = contrast;
  }
  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL('image/png');
}

async function runCameraOcr(file: File) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const titleCrop = await prepareCameraImageForOcr(file, 0.0, 0.16);
    const upperCrop = await prepareCameraImageForOcr(file, 0.0, 0.28);
    const widerCrop = await prepareCameraImageForOcr(file, 0.0, 0.42);

    const titleResult = await worker.recognize(titleCrop);
    const upperResult = await worker.recognize(upperCrop);
    const widerResult = await worker.recognize(widerCrop);

    return [
      titleResult.data.text || '',
      upperResult.data.text || '',
      widerResult.data.text || '',
    ].join('\n');
  } finally {
    await worker.terminate();
  }
}

async function findCardsFromCameraCandidate(candidate: string) {
  const exactQuery = `!"${escapeScryfallExactName(candidate)}"`;

  try {
    const exactMatches = await searchScryfallCards(exactQuery);
    if (exactMatches.length > 0) return exactMatches;
  } catch {
    // Fall back to Scryfall fuzzy name lookup below.
  }

  const fuzzyUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(candidate)}`;
  const fuzzyResponse = await fetch(fuzzyUrl);
  const fuzzyData = await fuzzyResponse.json().catch(() => ({}));

  if (!fuzzyResponse.ok || !fuzzyData.name) {
    const searched = await searchScryfallCards(candidate);
    return searched;
  }

  const printMatches = await searchScryfallCards(`!"${escapeScryfallExactName(fuzzyData.name)}"`);
  return printMatches.length > 0 ? printMatches : [fuzzyData as ScryfallCard];
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

function getOwnedCardTotal(card: Pick<OwnedCard, 'foilQuantity' | 'nonfoilQuantity' | 'totalQuantity'>) {
  const foilQuantity = Math.max(0, Number(card.foilQuantity || 0));
  const nonfoilQuantity = Math.max(0, Number(card.nonfoilQuantity || 0));
  const splitTotal = foilQuantity + nonfoilQuantity;
  const storedTotal = Math.max(0, Number(card.totalQuantity || 0));

  return splitTotal > 0 ? splitTotal : storedTotal;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('library');
  const [cards, setCards] = useState<OwnedCard[]>([]);
  const [decks, setDecks] = useState<DeckList[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [loadingDecks, setLoadingDecks] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function loadCards() {
    setLoadingCards(true);
    setNotice(null);
    try {
      const response = await fetch('/api/cards');
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json();
      setCards(data.cards || []);
    } catch (error) {
      setNotice({ type: 'error', message: apiErrorMessage(error) });
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
      setNotice({ type: 'error', message: apiErrorMessage(error) });
    } finally {
      setLoadingDecks(false);
    }
  }

  useEffect(() => {
    loadCards();
    loadDecks();
  }, []);

  const totalOwned = cards.reduce((sum, card) => sum + getOwnedCardTotal(card), 0);
  const totalUnique = cards.length;

  return (
    <main className="app-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">Personal MTG Library</p>
          <h1>Arcane Binder</h1>
          <p className="hero-copy">
            Track the cards you own, their quantity, foil split, language, exact printing and your notes.
          </p>
        </div>
        <div className="stat-stack" aria-label="Collection summary">
          <div>
            <strong>{totalOwned}</strong>
            <span>Total cards</span>
          </div>
          <div>
            <strong>{totalUnique}</strong>
            <span>Unique records</span>
          </div>
        </div>
      </header>

      <nav className="tab-bar" aria-label="App sections">
        <button className={activeTab === 'library' ? 'active' : ''} onClick={() => setActiveTab('library')}>Library</button>
        <button className={activeTab === 'add' ? 'active' : ''} onClick={() => setActiveTab('add')}>Add Card</button>
        <button className={activeTab === 'decks' ? 'active' : ''} onClick={() => setActiveTab('decks')}>100 Card Deck</button>
        <button className={activeTab === 'settings' ? 'active' : ''} onClick={() => setActiveTab('settings')}>Settings</button>
      </nav>

      {notice && <NoticeBanner notice={notice} onClose={() => setNotice(null)} />}

      {activeTab === 'library' && (
        <LibraryPage
          cards={cards}
          loading={loadingCards}
          onRefresh={loadCards}
          onNotice={setNotice}
          onCardsChanged={setCards}
        />
      )}

      {activeTab === 'add' && (
        <AddCardPage
          onCardAdded={(card) => {
            setCards((current) => [card, ...current]);
            setNotice({ type: 'success', message: `${card.name} was added to your library.` });
            setActiveTab('library');
          }}
          onCardsImported={(importedCards) => {
            setCards((current) => [...importedCards, ...current]);
            setNotice({ type: 'success', message: `${importedCards.length} card record(s) were imported to your library.` });
            setActiveTab('library');
          }}
          onNotice={setNotice}
        />
      )}

      {activeTab === 'decks' && (
        <DeckBuilderPage
          cards={cards}
          decks={decks}
          loadingDecks={loadingDecks}
          onDeckSaved={(deck) => setDecks((current) => [deck, ...current])}
          onDecksChanged={setDecks}
          onNotice={setNotice}
          onRefreshDecks={loadDecks}
        />
      )}

      {activeTab === 'settings' && <SettingsPage onRefreshCards={loadCards} onRefreshDecks={loadDecks} />}

      <footer className="legal-note">
        This is an unofficial fan-made collection tool. Magic: The Gathering and related card names,
        images, symbols and artwork are property of Wizards of the Coast. This app is not affiliated
        with, endorsed, sponsored or approved by Wizards of the Coast.
      </footer>
    </main>
  );
}

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <section className={`notice ${notice.type}`} role="status">
      <p>{notice.message}</p>
      <button onClick={onClose} aria-label="Close notice">×</button>
    </section>
  );
}

function LibraryPage({
  cards,
  loading,
  onRefresh,
  onNotice,
  onCardsChanged,
}: {
  cards: OwnedCard[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onNotice: (notice: Notice | null) => void;
  onCardsChanged: (cards: OwnedCard[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [setFilter, setSetFilter] = useState('All');
  const [foilFilter, setFoilFilter] = useState('All');
  const [languageFilter, setLanguageFilter] = useState('All');
  const [quantityFilter, setQuantityFilter] = useState('All');
  const [editingCard, setEditingCard] = useState<OwnedCard | null>(null);

  const setOptions = useMemo(() => uniqueValues(cards, (card) => card.setCode), [cards]);
  const languageFilterOptions = useMemo(() => uniqueValues(cards, (card) => card.language), [cards]);

  const filteredCards = cards.filter((card) => {
    const matchesSearch = card.name.toLowerCase().includes(search.toLowerCase().trim());
    const matchesSet = setFilter === 'All' || card.setCode === setFilter;
    const matchesFoil =
      foilFilter === 'All' ||
      (foilFilter === 'Foil' && card.foilQuantity > 0) ||
      (foilFilter === 'Non-foil' && card.nonfoilQuantity > 0);
    const matchesLanguage = languageFilter === 'All' || card.language === languageFilter;
    const matchesQuantity =
      quantityFilter === 'All' ||
      (quantityFilter === '1' && getOwnedCardTotal(card) === 1) ||
      (quantityFilter === '2+' && getOwnedCardTotal(card) >= 2) ||
      (quantityFilter === '4+' && getOwnedCardTotal(card) >= 4);

    return matchesSearch && matchesSet && matchesFoil && matchesLanguage && matchesQuantity;
  });

  async function deleteCard(card: OwnedCard) {
    if (!card.pageId) return;
    const confirmed = window.confirm(`Delete ${card.name} from your library?`);
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/cards?pageId=${encodeURIComponent(card.pageId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readApiError(response));
      onCardsChanged(cards.filter((item) => item.pageId !== card.pageId));
      onNotice({ type: 'success', message: `${card.name} was removed from your library.` });
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    }
  }

  return (
    <section className="page-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Library</p>
          <h2>Owned cards</h2>
        </div>
        <button className="secondary-button" onClick={onRefresh}>{loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>

      <div className="filter-grid">
        <label>
          Search card name
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Sol Ring" />
        </label>
        <label>
          Set
          <select value={setFilter} onChange={(event) => setSetFilter(event.target.value)}>
            <option>All</option>
            {setOptions.map((setCode) => <option key={setCode}>{setCode}</option>)}
          </select>
        </label>
        <label>
          Foil status
          <select value={foilFilter} onChange={(event) => setFoilFilter(event.target.value)}>
            <option>All</option>
            <option>Foil</option>
            <option>Non-foil</option>
          </select>
        </label>
        <label>
          Language
          <select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value)}>
            <option>All</option>
            {languageFilterOptions.map((language) => <option key={language}>{language}</option>)}
          </select>
        </label>
        <label>
          Quantity
          <select value={quantityFilter} onChange={(event) => setQuantityFilter(event.target.value)}>
            <option>All</option>
            <option value="1">1 copy</option>
            <option value="2+">2+ copies</option>
            <option value="4+">4+ copies</option>
          </select>
        </label>
      </div>

      {loading && <p className="muted">Loading cards from Notion…</p>}
      {!loading && filteredCards.length === 0 && (
        <div className="empty-state">
          <strong>No cards found.</strong>
          <span>Add a card or adjust the filters.</span>
        </div>
      )}

      <div className="card-grid">
        {filteredCards.map((card) => (
          <article className="owned-card" key={card.pageId || card.id}>
            {card.imageUrl ? <img src={card.imageUrl} alt={card.name} /> : <div className="image-placeholder">No image</div>}
            <div className="owned-card-body">
              <h3>{card.name}</h3>
              <p>{card.setName} · {card.setCode} #{card.collectorNumber}</p>
              <div className="pill-row">
                <span>{getOwnedCardTotal(card)} total</span>
                <span>{card.foilQuantity} foil</span>
                <span>{card.nonfoilQuantity} non-foil</span>
                <span>{card.language}</span>
              </div>
              {card.notes && <p className="notes-preview">{card.notes}</p>}
              <div className="button-row">
                <button onClick={() => setEditingCard(card)}>Edit</button>
                <button className="danger-button" onClick={() => deleteCard(card)}>Delete</button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {editingCard && (
        <EditCardModal
          card={editingCard}
          onClose={() => setEditingCard(null)}
          onSaved={(updatedCard) => {
            onCardsChanged(cards.map((card) => (card.pageId === updatedCard.pageId ? updatedCard : card)));
            setEditingCard(null);
            onNotice({ type: 'success', message: `${updatedCard.name} was updated.` });
          }}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}

function AddCardPage({
  onCardAdded,
  onCardsImported,
  onNotice,
}: {
  onCardAdded: (card: OwnedCard) => void;
  onCardsImported: (cards: OwnedCard[]) => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const [addMode, setAddMode] = useState<AddMode>('single');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(null);
  const [form, setForm] = useState(initialNewCard);
  const [saving, setSaving] = useState(false);

  const [cameraFile, setCameraFile] = useState<File | null>(null);
  const [cameraImageUrl, setCameraImageUrl] = useState('');
  const [cameraFileName, setCameraFileName] = useState('');
  const [cameraOcrText, setCameraOcrText] = useState('');
  const [cameraCandidates, setCameraCandidates] = useState<string[]>([]);
  const [cameraManualName, setCameraManualName] = useState('');
  const [cameraScanning, setCameraScanning] = useState(false);
  const [cameraSearching, setCameraSearching] = useState(false);
  const [cameraActiveCandidate, setCameraActiveCandidate] = useState('');

  const [importText, setImportText] = useState('');
  const [importLanguage, setImportLanguage] = useState('English');
  const [importFoilMode, setImportFoilMode] = useState<ImportFoilMode>('nonfoil');
  const [importNotes, setImportNotes] = useState('');
  const [importMatches, setImportMatches] = useState<MatchedCardImport[]>([]);
  const [resolvingImport, setResolvingImport] = useState(false);
  const [savingImport, setSavingImport] = useState(false);

  const totalQuantity = Number(form.nonfoilQuantity || 0) + Number(form.foilQuantity || 0);
  const matchedImportCount = importMatches.filter((item) => item.status === 'matched' && item.matchedCard).length;
  const failedImportCount = importMatches.filter((item) => item.status === 'not-found' || item.status === 'error').length;

  useEffect(() => {
    return () => {
      if (cameraImageUrl) URL.revokeObjectURL(cameraImageUrl);
    };
  }, [cameraImageUrl]);

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSelectedCard(null);
    onNotice(null);
    try {
      const found = await searchScryfallCards(query);
      setResults(found.slice(0, 24));
      if (found.length === 0) onNotice({ type: 'info', message: 'No Scryfall cards found.' });
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    } finally {
      setSearching(false);
    }
  }

  function selectCard(card: ScryfallCard) {
    setSelectedCard(card);
    setForm({ ...initialNewCard, language: labelLanguage(card.lang) });
  }

  function resetCameraScan() {
    setCameraFile(null);
    setCameraFileName('');
    setCameraOcrText('');
    setCameraCandidates([]);
    setCameraManualName('');
    setCameraActiveCandidate('');
    setResults([]);
    setSelectedCard(null);
    setForm(initialNewCard);
    setCameraImageUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return '';
    });
    onNotice(null);
  }

  async function saveSelectedCard(event: FormEvent) {
    event.preventDefault();
    if (!selectedCard) return;
    if (totalQuantity <= 0) {
      onNotice({ type: 'error', message: 'Add at least one foil or non-foil copy.' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        scryfallId: selectedCard.id,
        name: selectedCard.name,
        setName: selectedCard.set_name,
        setCode: selectedCard.set,
        collectorNumber: selectedCard.collector_number,
        imageUrl: getCardImage(selectedCard),
        foilQuantity: Number(form.foilQuantity || 0),
        nonfoilQuantity: Number(form.nonfoilQuantity || 0),
        language: form.language,
        notes: form.notes,
      };
      const response = await fetch('/api/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json();
      onCardAdded(data.card);
      setQuery('');
      setResults([]);
      setSelectedCard(null);
      setForm(initialNewCard);
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  function handleCameraFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onNotice({ type: 'error', message: 'Choose an image captured from your camera.' });
      event.target.value = '';
      return;
    }

    setCameraFile(file);
    setCameraFileName(file.name || 'Camera photo');
    setCameraOcrText('');
    setCameraCandidates([]);
    setCameraManualName('');
    setCameraActiveCandidate('');
    setResults([]);
    setSelectedCard(null);
    setForm(initialNewCard);
    setCameraImageUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return URL.createObjectURL(file);
    });
    onNotice({ type: 'info', message: 'Photo loaded. Tap Scan photo to read the card name.' });
    event.target.value = '';
  }

  async function searchCameraCandidate(candidate: string) {
    const trimmed = candidate.trim();
    if (!trimmed) return;

    setCameraSearching(true);
    setCameraActiveCandidate(trimmed);
    setCameraManualName(trimmed);
    setResults([]);
    setSelectedCard(null);
    onNotice({ type: 'info', message: `Searching Scryfall for “${trimmed}”…` });

    try {
      const found = await findCardsFromCameraCandidate(trimmed);
      setResults(found.slice(0, 24));
      if (found.length > 0) {
        selectCard(found[0]);
        onNotice({ type: 'success', message: `Found ${found.length} possible printings. Check the selected card before saving.` });
      } else {
        onNotice({ type: 'error', message: 'No Scryfall match found. Try another candidate or use Single card search.' });
      }
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    } finally {
      setCameraSearching(false);
    }
  }

  async function scanCameraPhoto() {
    if (!cameraFile) {
      onNotice({ type: 'error', message: 'Capture or upload a card photo first.' });
      return;
    }

    setCameraScanning(true);
    setCameraOcrText('');
    setCameraCandidates([]);
    setCameraManualName('');
    setResults([]);
    setSelectedCard(null);
    onNotice({ type: 'info', message: 'Scanning card title. Use a bright, straight photo for best results.' });

    try {
      const text = await runCameraOcr(cameraFile);
      const candidates = extractCameraCardCandidates(text);
      setCameraOcrText(text.trim());
      setCameraCandidates(candidates);
      setCameraManualName(candidates[0] || '');

      if (candidates.length === 0) {
        onNotice({ type: 'error', message: 'I could not read a clear card name. Type the card name below, or retake the photo closer to the title line.' });
        return;
      }

      await searchCameraCandidate(candidates[0]);
    } catch (error) {
      onNotice({ type: 'error', message: `Camera scan failed: ${apiErrorMessage(error)}` });
    } finally {
      setCameraScanning(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportText(text);
    setImportMatches([]);
    onNotice({ type: 'info', message: `${file.name} was loaded. Review the text, then parse and match.` });
    event.target.value = '';
  }

  async function parseAndMatchImport() {
    const parsed = parseCardListText(importText);
    if (parsed.length === 0) {
      onNotice({ type: 'error', message: 'No card lines were found. Use lines like "1 Sol Ring" or "2x Counterspell".' });
      setImportMatches([]);
      return;
    }

    setResolvingImport(true);
    onNotice({ type: 'info', message: `Matching ${parsed.length} card line(s) with Scryfall…` });
    const pending = parsed.map<MatchedCardImport>((item) => ({ ...item, status: 'pending' }));
    setImportMatches(pending);

    const resolved: MatchedCardImport[] = [];

    for (const item of parsed) {
      try {
        const matchedCard = await findScryfallCardForImport(item);
        resolved.push({ ...item, status: 'matched', matchedCard });
      } catch (error) {
        resolved.push({ ...item, status: 'not-found', error: apiErrorMessage(error) });
      }

      setImportMatches([
        ...resolved,
        ...parsed.slice(resolved.length).map<MatchedCardImport>((remaining) => ({ ...remaining, status: 'pending' })),
      ]);
    }

    const matched = resolved.filter((item) => item.status === 'matched').length;
    const failed = resolved.length - matched;
    onNotice({
      type: failed > 0 ? 'info' : 'success',
      message: failed > 0 ? `${matched} matched. ${failed} need manual review.` : `${matched} card line(s) matched and are ready to save.`,
    });
    setResolvingImport(false);
  }

  async function saveMatchedImport() {
    const matched = importMatches.filter((item) => item.status === 'matched' && item.matchedCard);
    if (matched.length === 0) {
      onNotice({ type: 'error', message: 'No matched cards are ready to save.' });
      return;
    }

    setSavingImport(true);
    const savedCards: OwnedCard[] = [];

    try {
      for (const item of matched) {
        const matchedCard = item.matchedCard as ScryfallCard;
        const saveAsFoil = item.foilHint || importFoilMode === 'foil';
        const payload = {
          scryfallId: matchedCard.id,
          name: matchedCard.name,
          setName: matchedCard.set_name,
          setCode: matchedCard.set,
          collectorNumber: matchedCard.collector_number,
          imageUrl: getCardImage(matchedCard),
          foilQuantity: saveAsFoil ? item.quantity : 0,
          nonfoilQuantity: saveAsFoil ? 0 : item.quantity,
          language: importLanguage,
          notes: makeImportNote(importNotes, item.originalLine),
        };

        const response = await fetch('/api/cards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const data = await response.json();
        savedCards.push(data.card);
      }

      setImportText('');
      setImportMatches([]);
      setImportNotes('');
      onCardsImported(savedCards);
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    } finally {
      setSavingImport(false);
    }
  }

  function clearImport() {
    setImportText('');
    setImportMatches([]);
    setImportNotes('');
    onNotice(null);
  }


  function renderSelectedCardForm() {
    if (!selectedCard) return null;

    return (
      <form className="detail-form" onSubmit={saveSelectedCard}>
        <h3>Add {selectedCard.name}</h3>
        <p className="muted">{selectedCard.set_name} · {selectedCard.set.toUpperCase()} #{selectedCard.collector_number}</p>
        <div className="form-grid two">
          <label>
            Non-foil quantity
            <input
              type="number"
              min="0"
              value={form.nonfoilQuantity}
              onChange={(event) => setForm({ ...form, nonfoilQuantity: Number(event.target.value) })}
            />
          </label>
          <label>
            Foil quantity
            <input
              type="number"
              min="0"
              value={form.foilQuantity}
              onChange={(event) => setForm({ ...form, foilQuantity: Number(event.target.value) })}
            />
          </label>
          <label>
            Calculated total
            <input value={totalQuantity} readOnly />
          </label>
          <label>
            Language
            <select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
              {languageOptions.map((language) => <option key={language}>{language}</option>)}
            </select>
          </label>
        </div>
        <label>
          Personal notes
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Optional notes" />
        </label>
        <button disabled={saving}>{saving ? 'Saving…' : 'Save to library'}</button>
      </form>
    );
  }

  return (
    <section className="page-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Add card</p>
          <h2>{addMode === 'single' ? 'Search exact printing' : addMode === 'camera' ? 'Add using phone camera' : 'Import from text list'}</h2>
        </div>
      </div>

      <div className="subtab-bar" aria-label="Add card options">
        <button type="button" className={addMode === 'single' ? 'active' : ''} onClick={() => setAddMode('single')}>Single card</button>
        <button type="button" className={addMode === 'bulk' ? 'active' : ''} onClick={() => setAddMode('bulk')}>Text file import</button>
        <button type="button" className={addMode === 'camera' ? 'active' : ''} onClick={() => setAddMode('camera')}>Camera scan</button>
      </div>

      {addMode === 'single' && (
        <>
          <form className="search-row" onSubmit={submitSearch}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search card name" />
            <button disabled={searching || !query.trim()}>{searching ? 'Searching…' : 'Search'}</button>
          </form>

          <div className="scryfall-grid">
            {results.map((card) => (
              <button
                className={`result-card ${selectedCard?.id === card.id ? 'selected' : ''}`}
                key={card.id}
                onClick={() => selectCard(card)}
              >
                {getCardImage(card) ? <img src={getCardImage(card)} alt={card.name} /> : <div className="image-placeholder">No image</div>}
                <span>{card.name}</span>
                <small>{card.set_name} · {card.set.toUpperCase()} #{card.collector_number}</small>
              </button>
            ))}
          </div>

          {renderSelectedCardForm()}
        </>
      )}


      {addMode === 'camera' && (
        <div className="camera-scan-panel">
          <div className="camera-help-card">
            <strong>Phone camera scan</strong>
            <span>Take a clear photo of the card, keeping the card name near the top sharp and well-lit.</span>
            <span>The scan will suggest a card name, then you choose the exact printing before saving.</span>
          </div>

          <label className="camera-upload-box">
            Capture or upload card photo
            <input type="file" accept="image/*" capture="environment" onChange={handleCameraFile} />
          </label>

          {cameraImageUrl && (
            <div className="camera-preview-grid">
              <div className="camera-preview-card">
                <img src={cameraImageUrl} alt="Card scan preview" />
                <span>{cameraFileName}</span>
              </div>
              <div className="camera-action-card">
                <h3>Scan this photo</h3>
                <p className="muted">OCR works best when the card fills the frame and the title line is not blurry.</p>
                <div className="button-row wrap">
                  <button type="button" onClick={scanCameraPhoto} disabled={cameraScanning || cameraSearching}>
                    {cameraScanning ? 'Scanning…' : cameraSearching ? 'Searching…' : 'Scan photo'}
                  </button>
                  <button type="button" className="secondary-button" onClick={resetCameraScan}>Clear photo</button>
                </div>
              </div>
            </div>
          )}

          {cameraCandidates.length > 0 && (
            <div className="camera-candidates">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Detected text</p>
                  <h3>Possible card names</h3>
                </div>
              </div>
              <div className="candidate-chip-row">
                {cameraCandidates.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    className={cameraActiveCandidate === candidate ? 'candidate-chip active' : 'candidate-chip'}
                    onClick={() => searchCameraCandidate(candidate)}
                    disabled={cameraSearching}
                  >
                    {candidate}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(cameraImageUrl || cameraOcrText) && (
            <form
              className="camera-manual-search"
              onSubmit={(event) => {
                event.preventDefault();
                searchCameraCandidate(cameraManualName);
              }}
            >
              <label>
                Correct card name
                <input
                  value={cameraManualName}
                  onChange={(event) => setCameraManualName(event.target.value)}
                  placeholder="Example: Coiling Oracle"
                />
              </label>
              <button type="submit" disabled={cameraSearching || !cameraManualName.trim()}>
                {cameraSearching ? 'Searching…' : 'Search Scryfall'}
              </button>
              <p className="muted">If OCR reads the wrong text, type the real card name here. The app will still show exact printings before saving.</p>
            </form>
          )}

          {cameraOcrText && (
            <details className="ocr-raw-details">
              <summary>Show raw OCR text</summary>
              <pre>{cameraOcrText}</pre>
            </details>
          )}

          {results.length > 0 && (
            <div className="camera-match-results">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Scryfall matches</p>
                  <h3>Choose exact printing</h3>
                </div>
              </div>
              <div className="scryfall-grid">
                {results.map((card) => (
                  <button
                    className={`result-card ${selectedCard?.id === card.id ? 'selected' : ''}`}
                    key={card.id}
                    onClick={() => selectCard(card)}
                  >
                    {getCardImage(card) ? <img src={getCardImage(card)} alt={card.name} /> : <div className="image-placeholder">No image</div>}
                    <span>{card.name}</span>
                    <small>{card.set_name} · {card.set.toUpperCase()} #{card.collector_number}</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {renderSelectedCardForm()}
        </div>
      )}

      {addMode === 'bulk' && (
        <div className="bulk-import-panel">
          <div className="import-help">
            <strong>Accepted list examples</strong>
            <span>1 Sol Ring</span>
            <span>2x Counterspell</span>
            <span>1 Arcane Signet [CMM] #648</span>
            <span>1 Command Tower (LTC) 350 foil</span>
          </div>

          <label>
            Upload text file
            <input type="file" accept=".txt,.csv,text/plain" onChange={handleImportFile} />
          </label>

          <label>
            Paste card list
            <textarea
              className="bulk-textarea"
              value={importText}
              onChange={(event) => {
                setImportText(event.target.value);
                setImportMatches([]);
              }}
              placeholder={"1 Sol Ring\n1 Arcane Signet\n1 Command Tower"}
            />
          </label>

          <div className="form-grid two">
            <label>
              Default language
              <select value={importLanguage} onChange={(event) => setImportLanguage(event.target.value)}>
                {languageOptions.map((language) => <option key={language}>{language}</option>)}
              </select>
            </label>
            <label>
              Default imported copies as
              <select value={importFoilMode} onChange={(event) => setImportFoilMode(event.target.value as ImportFoilMode)}>
                <option value="nonfoil">Non-foil</option>
                <option value="foil">Foil</option>
              </select>
            </label>
          </div>

          <label>
            Personal notes added to imported cards
            <textarea
              value={importNotes}
              onChange={(event) => setImportNotes(event.target.value)}
              placeholder="Optional note added to every imported card"
            />
          </label>

          <div className="button-row wrap">
            <button type="button" onClick={parseAndMatchImport} disabled={resolvingImport || !importText.trim()}>
              {resolvingImport ? 'Matching…' : 'Parse and match'}
            </button>
            <button type="button" className="secondary-button" onClick={clearImport}>Clear</button>
          </div>

          {importMatches.length > 0 && (
            <div className="import-preview">
              <div className="section-heading compact">
                <div>
                  <p className="eyebrow">Preview</p>
                  <h3>{matchedImportCount} matched · {failedImportCount} review</h3>
                </div>
                <button type="button" onClick={saveMatchedImport} disabled={savingImport || resolvingImport || matchedImportCount === 0}>
                  {savingImport ? 'Saving…' : 'Save matched cards'}
                </button>
              </div>

              <div className="import-preview-list">
                {importMatches.map((item) => (
                  <article className={`import-preview-row ${item.status}`} key={item.key}>
                    <div>
                      <strong>{item.quantity} {item.name}</strong>
                      <span>{item.originalLine}</span>
                    </div>
                    {item.status === 'pending' && <span className="status-pill">Matching…</span>}
                    {item.status === 'matched' && item.matchedCard && (
                      <span className="status-pill success">
                        {item.matchedCard.set_name} · {item.matchedCard.set.toUpperCase()} #{item.matchedCard.collector_number}
                      </span>
                    )}
                    {(item.status === 'not-found' || item.status === 'error') && (
                      <span className="status-pill error">Needs manual add</span>
                    )}
                  </article>
                ))}
              </div>

              {failedImportCount > 0 && (
                <p className="muted">Unmatched lines are not saved. Add those cards manually using Single card search.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EditCardModal({
  card,
  onClose,
  onSaved,
  onNotice,
}: {
  card: OwnedCard;
  onClose: () => void;
  onSaved: (card: OwnedCard) => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const [form, setForm] = useState({
    nonfoilQuantity: card.nonfoilQuantity,
    foilQuantity: card.foilQuantity,
    language: card.language || 'English',
    notes: card.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const totalQuantity = Number(form.nonfoilQuantity || 0) + Number(form.foilQuantity || 0);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!card.pageId) return;
    setSaving(true);
    try {
      const payload = {
        ...card,
        foilQuantity: Number(form.foilQuantity || 0),
        nonfoilQuantity: Number(form.nonfoilQuantity || 0),
        language: form.language,
        notes: form.notes,
      };
      const response = await fetch(`/api/cards?pageId=${encodeURIComponent(card.pageId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json();
      onSaved(data.card);
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal-card" onSubmit={save} onClick={(event) => event.stopPropagation()}>
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Edit card</p>
            <h2>{card.name}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close modal">×</button>
        </div>
        <div className="form-grid two">
          <label>
            Non-foil quantity
            <input
              type="number"
              min="0"
              value={form.nonfoilQuantity}
              onChange={(event) => setForm({ ...form, nonfoilQuantity: Number(event.target.value) })}
            />
          </label>
          <label>
            Foil quantity
            <input
              type="number"
              min="0"
              value={form.foilQuantity}
              onChange={(event) => setForm({ ...form, foilQuantity: Number(event.target.value) })}
            />
          </label>
          <label>
            Calculated total
            <input value={totalQuantity} readOnly />
          </label>
          <label>
            Language
            <select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
              {languageOptions.map((language) => <option key={language}>{language}</option>)}
            </select>
          </label>
        </div>
        <label>
          Personal notes
          <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
        </label>
        <button disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </form>
    </div>
  );
}

function DeckBuilderPage({
  cards,
  decks,
  loadingDecks,
  onDeckSaved,
  onDecksChanged,
  onNotice,
  onRefreshDecks,
}: {
  cards: OwnedCard[];
  decks: DeckList[];
  loadingDecks: boolean;
  onDeckSaved: (deck: DeckList) => void;
  onDecksChanged: (decks: DeckList[]) => void;
  onNotice: (notice: Notice | null) => void;
  onRefreshDecks: () => Promise<void>;
}) {
  const [deckName, setDeckName] = useState('');
  const [deckNotes, setDeckNotes] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [viewingDeck, setViewingDeck] = useState<DeckList | null>(null);

  const ownedByName = useMemo(() => {
    const map = new Map<string, number>();
    cards.forEach((card) => map.set(card.name, (map.get(card.name) || 0) + getOwnedCardTotal(card)));
    return Array.from(map.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);

  const deckCount = getDeckCount(entries);
  const deckText = makeDeckText(entries);

  const visibleOwnedCards = ownedByName.filter((card) => card.name.toLowerCase().includes(cardSearch.toLowerCase().trim()));

  function addToDeck(name: string) {
    if (deckCount >= 100) {
      onNotice({ type: 'error', message: 'This deck already has 100 cards.' });
      return;
    }
    const ownedQuantity = ownedByName.find((card) => card.name === name)?.quantity || 0;
    const currentQuantity = entries[name] || 0;
    if (currentQuantity >= ownedQuantity) {
      onNotice({ type: 'error', message: `You only have ${ownedQuantity} copy/copies of ${name}.` });
      return;
    }
    setEntries({ ...entries, [name]: currentQuantity + 1 });
  }

  function removeFromDeck(name: string) {
    const currentQuantity = entries[name] || 0;
    if (currentQuantity <= 1) {
      const nextEntries = { ...entries };
      delete nextEntries[name];
      setEntries(nextEntries);
      return;
    }
    setEntries({ ...entries, [name]: currentQuantity - 1 });
  }

  async function copyDeckText() {
    if (!deckText) {
      onNotice({ type: 'error', message: 'Add cards before copying a deck list.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(deckText);
      onNotice({ type: 'success', message: 'Deck list copied as plain text.' });
    } catch {
      onNotice({ type: 'error', message: 'Copy failed. Select the deck text and copy it manually.' });
    }
  }

  async function copySavedDeckText(deck: DeckList) {
    if (!deck.deckText) {
      onNotice({ type: 'error', message: 'This saved deck does not have any deck text.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(deck.deckText);
      onNotice({ type: 'success', message: `${deck.deckName} copied as plain text.` });
    } catch {
      onNotice({ type: 'error', message: 'Copy failed. Open the deck list and copy it manually.' });
    }
  }

  async function saveDeck() {
    if (!deckName.trim()) {
      onNotice({ type: 'error', message: 'Name the deck before saving.' });
      return;
    }
    if (deckCount === 0) {
      onNotice({ type: 'error', message: 'Add at least one card before saving.' });
      return;
    }
    if (deckCount > 100) {
      onNotice({ type: 'error', message: 'Deck count cannot be over 100.' });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckName, deckText, cardCount: deckCount, notes: deckNotes }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json();
      onDeckSaved(data.deck);
      onNotice({ type: 'success', message: `${deckName} was saved to Notion.` });
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteDeck(deck: DeckList) {
    if (!deck.pageId) return;
    const confirmed = window.confirm(`Delete ${deck.deckName}?`);
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/decks?pageId=${encodeURIComponent(deck.pageId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readApiError(response));
      onDecksChanged(decks.filter((item) => item.pageId !== deck.pageId));
      onNotice({ type: 'success', message: `${deck.deckName} was removed.` });
    } catch (error) {
      onNotice({ type: 'error', message: apiErrorMessage(error) });
    }
  }

  return (
    <section className="deck-layout">
      <div className="page-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Deck builder</p>
            <h2>100 card deck list</h2>
          </div>
          <div className={`deck-counter ${deckCount === 100 ? 'complete' : ''}`}>{deckCount} / 100</div>
        </div>

        <div className="form-grid two">
          <label>
            Deck name
            <input value={deckName} onChange={(event) => setDeckName(event.target.value)} placeholder="My Commander Deck" />
          </label>
          <label>
            Search owned cards
            <input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Find a card you own" />
          </label>
        </div>
        <label>
          Deck notes
          <textarea value={deckNotes} onChange={(event) => setDeckNotes(event.target.value)} placeholder="Optional notes" />
        </label>

        <div className="owned-list">
          {visibleOwnedCards.slice(0, 80).map((card) => (
            <div className="owned-list-row" key={card.name}>
              <div>
                <strong>{card.name}</strong>
                <span>{card.quantity} owned · {entries[card.name] || 0} in deck</span>
              </div>
              <button onClick={() => addToDeck(card.name)} disabled={deckCount >= 100}>Add</button>
            </div>
          ))}
        </div>
      </div>

      <aside className="page-card deck-output">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Copy text</p>
            <h2>Deck list</h2>
          </div>
        </div>
        <pre>{deckText || 'Add cards to generate a text deck list.'}</pre>
        <div className="button-row wrap">
          <button onClick={copyDeckText}>Copy text</button>
          <button onClick={saveDeck} disabled={saving}>{saving ? 'Saving…' : 'Save to Notion'}</button>
        </div>

        <div className="deck-entry-list">
          {Object.entries(entries).map(([name, quantity]) => (
            <div className="deck-entry" key={name}>
              <span>{quantity} {name}</span>
              <button className="secondary-button" onClick={() => removeFromDeck(name)}>Remove</button>
            </div>
          ))}
        </div>

        <hr />
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Saved</p>
            <h2>Notion decks</h2>
          </div>
          <button className="secondary-button" onClick={onRefreshDecks}>{loadingDecks ? 'Loading…' : 'Refresh'}</button>
        </div>
        {decks.length === 0 && <p className="muted">No saved decks yet.</p>}
        {decks.map((deck) => (
          <article className="saved-deck" key={deck.pageId || deck.id}>
            <div>
              <strong>{deck.deckName}</strong>
              <span>{deck.cardCount} cards</span>
            </div>
            <div className="saved-deck-actions">
              <button className="secondary-button" onClick={() => setViewingDeck(deck)}>View</button>
              <button className="secondary-button" onClick={() => copySavedDeckText(deck)}>Copy</button>
              <button className="danger-button" onClick={() => deleteDeck(deck)}>Delete</button>
            </div>
          </article>
        ))}
      </aside>

      {viewingDeck && (
        <ViewDeckModal
          deck={viewingDeck}
          onClose={() => setViewingDeck(null)}
          onNotice={onNotice}
        />
      )}
    </section>
  );
}

function ViewDeckModal({
  deck,
  onClose,
  onNotice,
}: {
  deck: DeckList;
  onClose: () => void;
  onNotice: (notice: Notice | null) => void;
}) {
  async function copyViewedDeckText() {
    if (!deck.deckText) {
      onNotice({ type: 'error', message: 'This saved deck does not have any deck text.' });
      return;
    }

    try {
      await navigator.clipboard.writeText(deck.deckText);
      onNotice({ type: 'success', message: `${deck.deckName} copied as plain text.` });
    } catch {
      onNotice({ type: 'error', message: 'Copy failed. Select the deck text and copy it manually.' });
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <article className="modal-card deck-view-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Saved deck list</p>
            <h2>{deck.deckName}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close deck list">×</button>
        </div>

        <div className="deck-view-meta">
          <span>{deck.cardCount} / 100 cards</span>
          {deck.updatedAt && <span>Updated {deck.updatedAt}</span>}
        </div>

        {deck.notes && (
          <div className="deck-view-notes">
            <strong>Notes</strong>
            <p>{deck.notes}</p>
          </div>
        )}

        <pre className="deck-view-pre">{deck.deckText || 'No deck text saved for this deck.'}</pre>

        <div className="button-row wrap">
          <button type="button" onClick={copyViewedDeckText}>Copy deck list</button>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>
      </article>
    </div>
  );
}

function SettingsPage({ onRefreshCards, onRefreshDecks }: { onRefreshCards: () => Promise<void>; onRefreshDecks: () => Promise<void> }) {
  return (
    <section className="page-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Settings</p>
          <h2>Project setup</h2>
        </div>
      </div>
      <div className="settings-grid">
        <div>
          <h3>Notion databases</h3>
          <p>Import the two CSV files, then set the Vercel environment variables for the database IDs.</p>
          <code>NOTION_TOKEN</code>
          <code>NOTION_OWNED_CARDS_DATABASE_ID</code>
          <code>NOTION_DECK_LISTS_DATABASE_ID</code>
        </div>
        <div>
          <h3>Tracked fields only</h3>
          <p>This app tracks card ownership, quantity, foil/non-foil split, language, set/printing and notes.</p>
        </div>
        <div>
          <h3>Data refresh</h3>
          <p>Refresh after editing directly inside Notion.</p>
          <div className="button-row wrap">
            <button onClick={onRefreshCards}>Refresh cards</button>
            <button onClick={onRefreshDecks}>Refresh decks</button>
          </div>
        </div>
      </div>
    </section>
  );
}
