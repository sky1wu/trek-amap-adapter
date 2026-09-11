import type { Coordinate } from '../geo/types.js';

export interface GooglePlace {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: Coordinate;
  rating?: number;
  nationalPhoneNumber?: string;
  types: string[];
  googleMapsUri: null;
  photos: never[];
  reviews: never[];
}

export interface GoogleSuggestion {
  placePrediction: {
    placeId: string;
    structuredFormat: {
      mainText: { text: string };
      secondaryText: { text: string };
    };
  };
}
