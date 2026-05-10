import type { ScryfallCard, ScryfallSearchResponse } from '../types';

export const languageLabels: Record<string, string> = {
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  zhs: 'Chinese Simplified',
  zht: 'Chinese Traditional',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  es: 'Spanish',
};

export function getCardImage(card: ScryfallCard): string {
  return (
    card.image_uris?.normal ||
    card.image_uris?.large ||
    card.image_uris?.small ||
    card.card_faces?.[0]?.image_uris?.normal ||
    card.card_faces?.[0]?.image_uris?.large ||
    card.card_faces?.[0]?.image_uris?.small ||
    ''
  );
}

export function labelLanguage(code: string): string {
  return languageLabels[code] || 'Other';
}

export async function searchScryfallCards(query: string): Promise<ScryfallCard[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const search = encodeURIComponent(trimmed);
  const url = `https://api.scryfall.com/cards/search?q=${search}&unique=prints&order=released&dir=desc`;
  const response = await fetch(url);
  const data = (await response.json()) as ScryfallSearchResponse;

  if (!response.ok) {
    throw new Error(data.details || 'Scryfall search failed.');
  }

  return data.data || [];
}
