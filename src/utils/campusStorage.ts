import type {
  BuildingCategory,
  CampusBuildingEntry,
  DiscoveredGooglePlace,
  ResolvedCampusLocation,
} from '../types/campus';

const STORAGE_KEY = 'itd_campus_contributions_v1';

export function loadLocalBuildings(
  baseBuildings: CampusBuildingEntry[]
): CampusBuildingEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return baseBuildings;
    const parsed = JSON.parse(raw) as CampusBuildingEntry[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return baseBuildings;
    }
    return parsed;
  } catch {
    return baseBuildings;
  }
}

export function saveLocalBuildings(buildings: CampusBuildingEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buildings));
}

export function clearLocalBuildings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function hasLocalOverrides(): boolean {
  return Boolean(localStorage.getItem(STORAGE_KEY));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function inferCategoryFromPlaceTypes(types?: string[]): BuildingCategory {
  if (!types || types.length === 0) return 'Académico';
  const joined = types.join(' ').toLowerCase();
  if (joined.includes('library')) return 'Biblioteca e Información';
  if (joined.includes('gym') || joined.includes('stadium') || joined.includes('sports')) {
    return 'Deporte y Cultura';
  }
  if (joined.includes('cafe') || joined.includes('restaurant') || joined.includes('store')) {
    return 'Servicios Estudiantiles';
  }
  return 'Académico';
}

export function mergeCampusLocations(
  communityBuildings: CampusBuildingEntry[],
  discoveredPlaces: DiscoveredGooglePlace[]
): ResolvedCampusLocation[] {
  const usedPlaceIds: Record<string, boolean> = {};
  const resolved: ResolvedCampusLocation[] = [];

  for (const entry of communityBuildings) {
    let matchedPlace: DiscoveredGooglePlace | undefined;

    if (entry.placeId) {
      matchedPlace = discoveredPlaces.find((p) => p.placeId === entry.placeId);
    }

    if (!matchedPlace && entry.matchKeywords.length > 0) {
      matchedPlace = discoveredPlaces.find((p) => {
        if (usedPlaceIds[p.placeId]) return false;
        const normalizedPlaceName = normalizeText(p.displayName);
        return entry.matchKeywords.some((kw) =>
          normalizedPlaceName.includes(normalizeText(kw))
        );
      });
    }

    if (matchedPlace) {
      usedPlaceIds[matchedPlace.placeId] = true;
    }

    const hasCustomCoords =
      Boolean(entry.customLatLng) &&
      typeof entry.customLatLng?.lat === 'number' &&
      typeof entry.customLatLng?.lng === 'number';

    const location = hasCustomCoords
      ? entry.customLatLng!
      : matchedPlace
        ? matchedPlace.location
        : null;

    const source: ResolvedCampusLocation['source'] = hasCustomCoords
      ? 'community-pin'
      : matchedPlace
        ? 'google-place'
        : 'unpinned';

    resolved.push({
      id: entry.id,
      code: entry.code,
      name: entry.name,
      category: entry.category,
      description: entry.description,
      location,
      source,
      placeId: entry.placeId ?? matchedPlace?.placeId,
      googleMapsURI: matchedPlace?.googleMapsURI,
      formattedAddress: matchedPlace?.formattedAddress,
      accessibilityNotes: entry.accessibilityNotes,
      updatedBy: entry.updatedBy,
      updatedAt: entry.updatedAt,
      spaces: entry.spaces,
      communityEntryId: entry.id,
    });
  }

  for (const place of discoveredPlaces) {
    if (usedPlaceIds[place.placeId]) continue;
    resolved.push({
      id: `gplace-${place.placeId}`,
      code: 'GM',
      name: place.displayName,
      category: inferCategoryFromPlaceTypes(place.types),
      description:
        place.formattedAddress ||
        'Ubicación descubierta en Google Maps dentro o cerca del campus ITD.',
      location: place.location,
      source: 'google-place',
      placeId: place.placeId,
      googleMapsURI: place.googleMapsURI,
      formattedAddress: place.formattedAddress,
      spaces: [],
    });
  }

  return resolved;
}

export function buildDirectoryExportJson(
  buildings: CampusBuildingEntry[]
): string {
  return JSON.stringify(
    {
      campusName: 'Instituto Tecnológico de Durango (TecNM)',
      version: '1.1.0',
      repositoryHint:
        'Catálogo de edificios, oficinas, aulas y laboratorios del Campus ITD.',
      buildings,
    },
    null,
    2
  );
}

function escapeCsv(val: string | number | undefined | null): string {
  const str = val === undefined || val === null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildDirectoryCsvExport(
  buildings: CampusBuildingEntry[]
): string {
  const headers = [
    'edificio_codigo',
    'edificio_nombre',
    'categoria',
    'latitud',
    'longitud',
    'espacio_codigo',
    'espacio_nombre',
    'tipo',
    'piso',
    'horario',
    'notas',
    'capturado_por',
    'fecha',
  ];

  const rows: string[] = [headers.join(',')];

  for (const b of buildings) {
    const lat = b.customLatLng?.lat ?? '';
    const lng = b.customLatLng?.lng ?? '';
    if (b.spaces.length === 0) {
      rows.push(
        [
          b.code,
          b.name,
          b.category,
          lat,
          lng,
          '',
          '',
          'Edificio',
          '',
          '',
          b.description,
          b.updatedBy ?? '',
          b.updatedAt ?? '',
        ]
          .map(escapeCsv)
          .join(',')
      );
    } else {
      for (const sp of b.spaces) {
        rows.push(
          [
            b.code,
            b.name,
            b.category,
            lat,
            lng,
            sp.code,
            sp.name,
            sp.kind,
            sp.floor,
            sp.schedule ?? '',
            sp.notes ?? '',
            b.updatedBy ?? '',
            b.updatedAt ?? '',
          ]
            .map(escapeCsv)
            .join(',')
        );
      }
    }
  }

  return '\uFEFF' + rows.join('\n');
}

