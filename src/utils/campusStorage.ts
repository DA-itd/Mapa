import type {
  BuildingCategory,
  CampusBuildingEntry,
  CampusSpace,
  DiscoveredGooglePlace,
  ResolvedCampusLocation,
  SpaceKind,
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

function parseCsvMatrix(rawText: string): string[][] {
  const text = rawText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      continue;
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some((v) => v.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim().length > 0)) {
    rows.push(row);
  }
  return rows;
}

const VALID_SPACE_KINDS: SpaceKind[] = [
  'Aula',
  'Laboratorio',
  'Oficina',
  'Servicio',
  'Auditorio',
];

function toSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || Date.now().toString(36)
  );
}

export function parseImportedDirectoryFile(
  fileName: string,
  content: string
): CampusBuildingEntry[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json') || content.trim().startsWith('{') || content.trim().startsWith('[')) {
    const parsed = JSON.parse(content) as
      | {buildings?: CampusBuildingEntry[]}
      | CampusBuildingEntry[];
    const list = Array.isArray(parsed) ? parsed : parsed?.buildings;
    if (!Array.isArray(list)) {
      throw new Error(`Formato JSON no válido en ${fileName}`);
    }
    return list.filter((b) => b && typeof b.name === 'string');
  }

  const matrix = parseCsvMatrix(content);
  if (matrix.length < 2) {
    throw new Error(`El archivo CSV ${fileName} no contiene registros.`);
  }

  const headers = matrix[0].map((h) => normalizeText(h));
  const col = (name: string) => headers.indexOf(normalizeText(name));

  const idxCode = col('edificio_codigo');
  const idxName = col('edificio_nombre');
  const idxCat = col('categoria');
  const idxLat = col('latitud');
  const idxLng = col('longitud');
  const idxSpCode = col('espacio_codigo');
  const idxSpName = col('espacio_nombre');
  const idxKind = col('tipo');
  const idxFloor = col('piso');
  const idxSched = col('horario');
  const idxNotes = col('notas');
  const idxBy = col('capturado_por');
  const idxDate = col('fecha');

  if (idxName === -1) {
    throw new Error(`Encabezados no reconocidos en ${fileName}`);
  }

  const byKey = new Map<string, CampusBuildingEntry>();

  for (let r = 1; r < matrix.length; r++) {
    const cols = matrix[r];
    const bName = (cols[idxName] ?? '').trim();
    if (!bName) continue;
    const bCode = (idxCode >= 0 ? cols[idxCode] : '')?.trim() || 'ITD';
    const bKey = `${normalizeText(bCode)}::${normalizeText(bName)}`;

    const latRaw = idxLat >= 0 ? Number.parseFloat(cols[idxLat] ?? '') : Number.NaN;
    const lngRaw = idxLng >= 0 ? Number.parseFloat(cols[idxLng] ?? '') : Number.NaN;
    const coords =
      Number.isFinite(latRaw) && Number.isFinite(lngRaw)
        ? {lat: latRaw, lng: lngRaw}
        : null;

    let entry = byKey.get(bKey);
    if (!entry) {
      entry = {
        id: `itd-${toSlug(bCode === 'ITD' ? bName : `${bCode}-${bName}`)}`,
        code: bCode,
        name: bName,
        category: ((idxCat >= 0 ? cols[idxCat]?.trim() : '') ||
          'Académico') as BuildingCategory,
        description: 'Integrado desde levantamiento CSV.',
        matchKeywords: [bName.toLowerCase(), bCode.toLowerCase()],
        customLatLng: coords,
        updatedBy: idxBy >= 0 ? cols[idxBy]?.trim() || undefined : undefined,
        updatedAt: idxDate >= 0 ? cols[idxDate]?.trim() || undefined : undefined,
        spaces: [],
      };
      byKey.set(bKey, entry);
    } else if (!entry.customLatLng && coords) {
      entry.customLatLng = coords;
    }

    const spName = idxSpName >= 0 ? (cols[idxSpName] ?? '').trim() : '';
    const spCode = idxSpCode >= 0 ? (cols[idxSpCode] ?? '').trim() : '';
    const rawKind = (idxKind >= 0 ? cols[idxKind] ?? '' : '').trim();

    if ((spName || spCode) && rawKind !== 'Edificio') {
      const matchedKind =
        VALID_SPACE_KINDS.find(
          (k) => normalizeText(k) === normalizeText(rawKind)
        ) ?? 'Aula';
      const sp: CampusSpace = {
        id: `sp-${toSlug(`${bCode}-${spCode}-${spName}`)}-${r}`,
        code: spCode || 'S/N',
        name: spName || `${matchedKind} ${spCode}`,
        kind: matchedKind,
        floor: (idxFloor >= 0 ? cols[idxFloor]?.trim() : '') || 'Planta Baja',
        schedule: idxSched >= 0 ? cols[idxSched]?.trim() || undefined : undefined,
        notes: idxNotes >= 0 ? cols[idxNotes]?.trim() || undefined : undefined,
      };
      entry.spaces.push(sp);
    }
  }

  return Array.from(byKey.values());
}

export function mergeBuildingCollections(
  baseBuildings: CampusBuildingEntry[],
  importedLists: CampusBuildingEntry[][]
): {
  merged: CampusBuildingEntry[];
  addedBuildings: number;
  addedSpaces: number;
  updatedCoords: number;
} {
  const merged = baseBuildings.map((b) => ({
    ...b,
    spaces: b.spaces.map((s) => ({...s})),
  }));

  let addedBuildings = 0;
  let addedSpaces = 0;
  let updatedCoords = 0;

  const findMatchIndex = (incoming: CampusBuildingEntry): number => {
    const incId = normalizeText(incoming.id);
    const incCode = normalizeText(incoming.code);
    const incName = normalizeText(incoming.name);
    return merged.findIndex(
      (b) =>
        normalizeText(b.id) === incId ||
        (incCode && incCode !== 'itd' && normalizeText(b.code) === incCode) ||
        normalizeText(b.name) === incName
    );
  };

  for (const list of importedLists) {
    for (const incoming of list) {
      const idx = findMatchIndex(incoming);
      if (idx === -1) {
        merged.push({
          ...incoming,
          spaces: (incoming.spaces ?? []).map((s) => ({...s})),
        });
        addedBuildings += 1;
        addedSpaces += incoming.spaces?.length ?? 0;
        continue;
      }

      const target = merged[idx];
      const incCoords = incoming.customLatLng;
      if (
        incCoords &&
        typeof incCoords.lat === 'number' &&
        typeof incCoords.lng === 'number'
      ) {
        const shouldReplaceCoords =
          !target.customLatLng ||
          (incoming.updatedAt &&
            (!target.updatedAt || incoming.updatedAt >= target.updatedAt));
        if (shouldReplaceCoords) {
          if (
            !target.customLatLng ||
            target.customLatLng.lat !== incCoords.lat ||
            target.customLatLng.lng !== incCoords.lng
          ) {
            updatedCoords += 1;
          }
          target.customLatLng = incCoords;
        }
      }

      if (
        incoming.updatedAt &&
        (!target.updatedAt || incoming.updatedAt >= target.updatedAt)
      ) {
        target.updatedAt = incoming.updatedAt;
        if (incoming.updatedBy) {
          target.updatedBy = incoming.updatedBy;
        }
      }

      const existingKeys = new Set(
        target.spaces.map(
          (s) =>
            `${normalizeText(s.code)}|${normalizeText(s.name)}|${normalizeText(s.floor)}`
        )
      );

      for (const sp of incoming.spaces ?? []) {
        const key = `${normalizeText(sp.code)}|${normalizeText(sp.name)}|${normalizeText(sp.floor)}`;
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          target.spaces.push({...sp});
          addedSpaces += 1;
        }
      }
    }
  }

  return {merged, addedBuildings, addedSpaces, updatedCoords};
}


