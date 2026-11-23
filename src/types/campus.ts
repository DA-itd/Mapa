export type SpaceKind =
  | 'Aula'
  | 'Laboratorio'
  | 'Oficina'
  | 'Servicio'
  | 'Auditorio';

export type BuildingCategory =
  | 'Académico'
  | 'Laboratorios'
  | 'Administrativo'
  | 'Biblioteca e Información'
  | 'Deporte y Cultura'
  | 'Servicios Estudiantiles';

export interface CampusSpace {
  id: string;
  name: string;
  code: string;
  kind: SpaceKind;
  floor: string;
  schedule?: string;
  notes?: string;
}

export interface CampusBuildingEntry {
  id: string;
  code: string;
  name: string;
  category: BuildingCategory;
  description: string;
  /** Keywords used to match against live Google Maps Places results on campus */
  matchKeywords: string[];
  /** Optional Google Maps Place ID confirmed by a contributor */
  placeId?: string;
  /** Optional pin coordinates set manually by a contributor clicking on the map */
  customLatLng?: {lat: number; lng: number} | null;
  accessibilityNotes?: string;
  updatedBy?: string;
  updatedAt?: string;
  spaces: CampusSpace[];
}

export interface DiscoveredGooglePlace {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  location: {lat: number; lng: number};
  googleMapsURI?: string;
  primaryType?: string;
  types?: string[];
}

export interface ResolvedCampusLocation {
  id: string;
  code: string;
  name: string;
  category: BuildingCategory;
  description: string;
  location: {lat: number; lng: number} | null;
  source: 'google-place' | 'community-pin' | 'unpinned';
  placeId?: string;
  googleMapsURI?: string;
  formattedAddress?: string;
  accessibilityNotes?: string;
  updatedBy?: string;
  updatedAt?: string;
  spaces: CampusSpace[];
  communityEntryId?: string;
}

export type TravelModeOption = 'WALKING' | 'BICYCLING' | 'DRIVING';

export interface RouteStepInfo {
  index: number;
  instruction: string;
  maneuver: string;
  distanceMeters: number;
  distanceText: string;
  durationText: string;
  startLocation: {lat: number; lng: number} | null;
  endLocation: {lat: number; lng: number} | null;
}

export interface ComputedRouteResult {
  distanceMeters: number;
  durationMillis: number;
  distanceText: string;
  durationText: string;
  steps: RouteStepInfo[];
}

export interface GroundingChunkItem {
  title: string;
  uri: string;
  placeId?: string;
  reviewSnippets: {
    author: string;
    text: string;
    uri: string;
  }[];
}
