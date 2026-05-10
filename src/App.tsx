import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { DeckList, OwnedCard, ScryfallCard } from './types';
import { getCardImage, labelLanguage, searchScryfallCards } from './lib/scryfall';

type Tab = 'library' | 'add' | 'decks' | 'settings';

type Notice = {
  type: 'success' | 'error' | 'info';
  message: string;
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

  const totalOwned = cards.reduce((sum, card) => sum + card.totalQuantity, 0);
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
      (quantityFilter === '1' && card.totalQuantity === 1) ||
      (quantityFilter === '2+' && card.totalQuantity >= 2) ||
      (quantityFilter === '4+' && card.totalQuantity >= 4);

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
                <span>{card.totalQuantity} total</span>
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
  onNotice,
}: {
  onCardAdded: (card: OwnedCard) => void;
  onNotice: (notice: Notice | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<ScryfallCard | null>(null);
  const [form, setForm] = useState(initialNewCard);
  const [saving, setSaving] = useState(false);

  const totalQuantity = Number(form.nonfoilQuantity || 0) + Number(form.foilQuantity || 0);

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
        totalQuantity,
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

  return (
    <section className="page-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Add card</p>
          <h2>Search exact printing</h2>
        </div>
      </div>

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

      {selectedCard && (
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
              Total quantity
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
        totalQuantity,
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
            Total quantity
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

  const ownedByName = useMemo(() => {
    const map = new Map<string, number>();
    cards.forEach((card) => map.set(card.name, (map.get(card.name) || 0) + card.totalQuantity));
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
            <strong>{deck.deckName}</strong>
            <span>{deck.cardCount} cards</span>
            <button className="danger-button" onClick={() => deleteDeck(deck)}>Delete</button>
          </article>
        ))}
      </aside>
    </section>
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
