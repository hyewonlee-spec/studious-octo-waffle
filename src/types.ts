export type LanguageOption =
  | 'English'
  | 'Japanese'
  | 'Korean'
  | 'Chinese Simplified'
  | 'Chinese Traditional'
  | 'French'
  | 'German'
  | 'Italian'
  | 'Portuguese'
  | 'Russian'
  | 'Spanish'
  | 'Other';

export type OwnedCard = {
  pageId?: string;
  id: string;
  scryfallId: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  imageUrl: string;
  totalQuantity: number;
  foilQuantity: number;
  nonfoilQuantity: number;
  language: LanguageOption | string;
  notes: string;
  addedAt: string;
  updatedAt: string;
};

export type DeckList = {
  pageId?: string;
  id: string;
  deckName: string;
  deckText: string;
  cardCount: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ScryfallCard = {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  lang: string;
  foil: boolean;
  nonfoil: boolean;
  image_uris?: {
    small?: string;
    normal?: string;
    large?: string;
  };
  card_faces?: Array<{
    image_uris?: {
      small?: string;
      normal?: string;
      large?: string;
    };
  }>;
};

export type ScryfallSearchResponse = {
  object: string;
  total_cards?: number;
  has_more?: boolean;
  data?: ScryfallCard[];
  details?: string;
};
