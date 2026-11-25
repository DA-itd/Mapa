import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {OperationType, db, handleFirestoreError} from '../firebase';
import type {
  BuildingCategory,
  CampusBuildingEntry,
  CampusSpace,
  SpaceKind,
} from '../types/campus';

const VALID_CATEGORIES: BuildingCategory[] = [
  'Académico',
  'Laboratorios',
  'Administrativo',
  'Biblioteca e Información',
  'Deporte y Cultura',
  'Servicios Estudiantiles',
];

const VALID_SPACE_KINDS: SpaceKind[] = [
  'Aula',
  'Laboratorio',
  'Oficina',
  'Servicio',
  'Auditorio',
];

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface CloudBuildingDoc {
  id: string;
  code: string;
  name: string;
  category: BuildingCategory;
  description: string;
  matchKeywords: string[];
  placeId?: string;
  customLatLng?: {lat: number; lng: number} | null;
  accessibilityNotes?: string;
  visibility: 'public';
  updatedBy?: string;
  createdByUid: string;
  updatedByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface CloudSpaceDoc {
  id: string;
  buildingId: string;
  code: string;
  name: string;
  kind: SpaceKind;
  floor: string;
  schedule?: string;
  notes?: string;
  visibility: 'public';
  createdByName?: string;
  createdByUid: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export function sanitizeFirestoreId(rawId: string, prefix = 'itd'): string {
  const cleaned = rawId
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110);
  if (cleaned && ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `${prefix}-${Date.now().toString(36)}`;
}

function clampString(value: string | undefined | null, maxLen: number): string {
  return (value ?? '').trim().slice(0, maxLen);
}

function sanitizeLatLng(
  coords: {lat: number; lng: number} | null | undefined
): {lat: number; lng: number} | null {
  if (!coords) return null;
  if (
    typeof coords.lat !== 'number' ||
    typeof coords.lng !== 'number' ||
    !Number.isFinite(coords.lat) ||
    !Number.isFinite(coords.lng) ||
    coords.lat < -90 ||
    coords.lat > 90 ||
    coords.lng < -180 ||
    coords.lng > 180
  ) {
    return null;
  }
  return {
    lat: Number(coords.lat.toFixed(7)),
    lng: Number(coords.lng.toFixed(7)),
  };
}

function formatDocDate(ts?: Timestamp): string | undefined {
  if (!ts || typeof ts.toDate !== 'function') return undefined;
  return ts.toDate().toISOString().slice(0, 10);
}

function buildBuildingWritePayload(
  building: CampusBuildingEntry,
  uid: string,
  displayName: string | undefined,
  existingDoc?: CloudBuildingDoc
): Record<string, unknown> {
  const id = sanitizeFirestoreId(building.id, 'itd');
  const code = clampString(building.code, 20) || 'ITD';
  const name = clampString(building.name, 140) || code;
  const category = VALID_CATEGORIES.includes(building.category)
    ? building.category
    : 'Académico';
  const description = clampString(building.description, 600);
  const matchKeywords = (building.matchKeywords ?? [])
    .map((kw) => clampString(kw, 60))
    .filter((kw) => kw.length > 0)
    .slice(0, 15);
  const customLatLng = sanitizeLatLng(building.customLatLng);
  const updatedByLabel = clampString(
    building.updatedBy || displayName || 'Brigada ITD',
    80
  );

  const payload: Record<string, unknown> = {
    id,
    code,
    name,
    category,
    description,
    matchKeywords,
    visibility: 'public',
    createdByUid: existingDoc?.createdByUid ?? uid,
    updatedByUid: uid,
    createdAt: existingDoc?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (building.placeId && clampString(building.placeId, 160)) {
    payload.placeId = clampString(building.placeId, 160);
  }
  if (customLatLng !== null || building.customLatLng === null) {
    payload.customLatLng = customLatLng;
  }
  if (
    building.accessibilityNotes &&
    clampString(building.accessibilityNotes, 300)
  ) {
    payload.accessibilityNotes = clampString(building.accessibilityNotes, 300);
  }
  if (updatedByLabel) {
    payload.updatedBy = updatedByLabel;
  }

  return payload;
}

function buildSpaceWritePayload(
  space: CampusSpace,
  buildingId: string,
  uid: string,
  displayName: string | undefined,
  existingDoc?: CloudSpaceDoc
): Record<string, unknown> {
  const id = sanitizeFirestoreId(space.id, 'sp');
  const cleanBuildingId = sanitizeFirestoreId(buildingId, 'itd');
  const code = clampString(space.code, 30) || 'S/N';
  const kind = VALID_SPACE_KINDS.includes(space.kind) ? space.kind : 'Aula';
  const name = clampString(space.name, 140) || `${kind} ${code}`;
  const floor = clampString(space.floor, 50) || 'Planta Baja';

  const payload: Record<string, unknown> = {
    id,
    buildingId: cleanBuildingId,
    code,
    name,
    kind,
    floor,
    visibility: 'public',
    createdByUid: existingDoc?.createdByUid ?? uid,
    createdAt: existingDoc?.createdAt ?? serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const sched = clampString(space.schedule, 120);
  if (sched) payload.schedule = sched;
  const notes = clampString(space.notes, 300);
  if (notes) payload.notes = notes;
  const creatorName = clampString(displayName || 'Brigada ITD', 80);
  if (creatorName) payload.createdByName = creatorName;

  return payload;
}

function normalizeSpaceKey(sp: Pick<CampusSpace, 'code' | 'name' | 'floor'>): string {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  return `${norm(sp.code)}|${norm(sp.name)}|${norm(sp.floor)}`;
}

export function mergeCloudIntoBuildings(
  baseBuildings: CampusBuildingEntry[],
  cloudBuildings: Map<string, CloudBuildingDoc>,
  cloudSpaces: Map<string, CloudSpaceDoc>
): CampusBuildingEntry[] {
  const spacesByBuilding = new Map<string, CloudSpaceDoc[]>();
  for (const sp of cloudSpaces.values()) {
    const list = spacesByBuilding.get(sp.buildingId) ?? [];
    list.push(sp);
    spacesByBuilding.set(sp.buildingId, list);
  }

  const mergedMap = new Map<string, CampusBuildingEntry>();

  for (const base of baseBuildings) {
    const cloudB = cloudBuildings.get(base.id);
    const mergedEntry: CampusBuildingEntry = {
      ...base,
      code: cloudB?.code ?? base.code,
      name: cloudB?.name ?? base.name,
      category: cloudB?.category ?? base.category,
      description: cloudB?.description || base.description,
      matchKeywords:
        cloudB?.matchKeywords && cloudB.matchKeywords.length > 0
          ? cloudB.matchKeywords
          : base.matchKeywords,
      placeId: cloudB?.placeId ?? base.placeId,
      customLatLng:
        cloudB && 'customLatLng' in cloudB
          ? cloudB.customLatLng ?? null
          : base.customLatLng ?? null,
      accessibilityNotes:
        cloudB?.accessibilityNotes ?? base.accessibilityNotes,
      updatedBy: cloudB?.updatedBy ?? base.updatedBy,
      updatedAt: formatDocDate(cloudB?.updatedAt) ?? base.updatedAt,
      spaces: base.spaces.map((s) => ({...s})),
    };
    mergedMap.set(base.id, mergedEntry);
  }

  for (const cloudB of cloudBuildings.values()) {
    if (mergedMap.has(cloudB.id)) continue;
    mergedMap.set(cloudB.id, {
      id: cloudB.id,
      code: cloudB.code,
      name: cloudB.name,
      category: cloudB.category,
      description: cloudB.description,
      matchKeywords: cloudB.matchKeywords,
      placeId: cloudB.placeId,
      customLatLng: cloudB.customLatLng ?? null,
      accessibilityNotes: cloudB.accessibilityNotes,
      updatedBy: cloudB.updatedBy,
      updatedAt: formatDocDate(cloudB.updatedAt),
      spaces: [],
    });
  }

  for (const [bId, spDocs] of spacesByBuilding.entries()) {
    const target = mergedMap.get(bId);
    if (!target) continue;
    const seenKeys = new Set(target.spaces.map(normalizeSpaceKey));
    const existingById = new Set(target.spaces.map((s) => s.id));

    for (const spDoc of spDocs) {
      const spEntry: CampusSpace = {
        id: spDoc.id,
        code: spDoc.code,
        name: spDoc.name,
        kind: spDoc.kind,
        floor: spDoc.floor,
        schedule: spDoc.schedule,
        notes: spDoc.notes,
      };
      if (existingById.has(spDoc.id)) {
        target.spaces = target.spaces.map((s) =>
          s.id === spDoc.id ? spEntry : s
        );
        continue;
      }
      const key = normalizeSpaceKey(spEntry);
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        target.spaces.push(spEntry);
      }
    }
  }

  return Array.from(mergedMap.values());
}

export function subscribeCampusCloudData(
  onUpdate: (
    cloudBuildings: Map<string, CloudBuildingDoc>,
    cloudSpaces: Map<string, CloudSpaceDoc>
  ) => void
): () => void {
  let latestBuildings = new Map<string, CloudBuildingDoc>();
  let latestSpaces = new Map<string, CloudSpaceDoc>();

  const buildingsQuery = query(
    collection(db, 'campusBuildings'),
    where('visibility', '==', 'public')
  );
  const spacesQuery = query(
    collection(db, 'campusSpaces'),
    where('visibility', '==', 'public')
  );

  const unsubBuildings = onSnapshot(
    buildingsQuery,
    (snapshot) => {
      const next = new Map<string, CloudBuildingDoc>();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as CloudBuildingDoc;
        next.set(docSnap.id, {...data, id: docSnap.id});
      });
      latestBuildings = next;
      onUpdate(latestBuildings, latestSpaces);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'campusBuildings');
    }
  );

  const unsubSpaces = onSnapshot(
    spacesQuery,
    (snapshot) => {
      const next = new Map<string, CloudSpaceDoc>();
      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as CloudSpaceDoc;
        next.set(docSnap.id, {...data, id: docSnap.id});
      });
      latestSpaces = next;
      onUpdate(latestBuildings, latestSpaces);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'campusSpaces');
    }
  );

  return () => {
    unsubBuildings();
    unsubSpaces();
  };
}

export async function saveCloudBuildingWithSpaces(params: {
  building: CampusBuildingEntry;
  uid: string;
  displayName?: string;
  cloudBuildings: Map<string, CloudBuildingDoc>;
  cloudSpaces: Map<string, CloudSpaceDoc>;
}): Promise<void> {
  const {building, uid, displayName, cloudBuildings, cloudSpaces} = params;
  const buildingId = sanitizeFirestoreId(building.id, 'itd');
  const existingBuilding = cloudBuildings.get(buildingId);

  try {
    const batch = writeBatch(db);
    const buildingRef = doc(db, 'campusBuildings', buildingId);
    batch.set(
      buildingRef,
      buildBuildingWritePayload(building, uid, displayName, existingBuilding)
    );

    const existingCloudSpacesForBuilding = Array.from(
      cloudSpaces.values()
    ).filter((s) => s.buildingId === buildingId);
    const existingKeys = new Set(
      existingCloudSpacesForBuilding.map(normalizeSpaceKey)
    );

    for (const sp of building.spaces) {
      const spId = sanitizeFirestoreId(sp.id, 'sp');
      const existingSp = cloudSpaces.get(spId);
      if (existingSp) {
        if (existingSp.createdByUid === uid) {
          batch.set(
            doc(db, 'campusSpaces', spId),
            buildSpaceWritePayload(sp, buildingId, uid, displayName, existingSp)
          );
        }
        continue;
      }
      const key = normalizeSpaceKey(sp);
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        batch.set(
          doc(db, 'campusSpaces', spId),
          buildSpaceWritePayload(sp, buildingId, uid, displayName)
        );
      }
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `campusBuildings/${buildingId}`
    );
  }
}

export async function saveCloudSurveyPoint(params: {
  building: CampusBuildingEntry;
  newSpace: CampusSpace | null;
  uid: string;
  displayName?: string;
  cloudBuildings: Map<string, CloudBuildingDoc>;
}): Promise<void> {
  const {building, newSpace, uid, displayName, cloudBuildings} = params;
  const buildingId = sanitizeFirestoreId(building.id, 'itd');
  const existingBuilding = cloudBuildings.get(buildingId);

  try {
    const batch = writeBatch(db);
    const buildingRef = doc(db, 'campusBuildings', buildingId);
    batch.set(
      buildingRef,
      buildBuildingWritePayload(building, uid, displayName, existingBuilding)
    );

    if (newSpace) {
      const spaceId = sanitizeFirestoreId(newSpace.id, 'sp');
      batch.set(
        doc(db, 'campusSpaces', spaceId),
        buildSpaceWritePayload(newSpace, buildingId, uid, displayName)
      );
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `campusBuildings/${buildingId}`
    );
  }
}

export async function deleteCloudSpaceById(spaceId: string): Promise<void> {
  const cleanId = sanitizeFirestoreId(spaceId, 'sp');
  try {
    await deleteDoc(doc(db, 'campusSpaces', cleanId));
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.DELETE,
      `campusSpaces/${cleanId}`
    );
  }
}

export async function syncBatchToCloud(params: {
  buildings: CampusBuildingEntry[];
  uid: string;
  displayName?: string;
  cloudBuildings: Map<string, CloudBuildingDoc>;
  cloudSpaces: Map<string, CloudSpaceDoc>;
}): Promise<{buildingsSynced: number; spacesSynced: number}> {
  const {buildings, uid, displayName, cloudBuildings, cloudSpaces} = params;

  const operations: Array<{
    type: 'building' | 'space';
    refPath: string;
    id: string;
    payload: Record<string, unknown>;
  }> = [];

  let buildingsSynced = 0;
  let spacesSynced = 0;

  const existingSpaceKeysByBuilding = new Map<string, Set<string>>();
  for (const sp of cloudSpaces.values()) {
    const set =
      existingSpaceKeysByBuilding.get(sp.buildingId) ?? new Set<string>();
    set.add(normalizeSpaceKey(sp));
    existingSpaceKeysByBuilding.set(sp.buildingId, set);
  }

  for (const b of buildings) {
    const buildingId = sanitizeFirestoreId(b.id, 'itd');
    const existingBuilding = cloudBuildings.get(buildingId);
    operations.push({
      type: 'building',
      refPath: 'campusBuildings',
      id: buildingId,
      payload: buildBuildingWritePayload(b, uid, displayName, existingBuilding),
    });
    buildingsSynced += 1;

    const seenKeys =
      existingSpaceKeysByBuilding.get(buildingId) ?? new Set<string>();
    existingSpaceKeysByBuilding.set(buildingId, seenKeys);

    for (const sp of b.spaces) {
      const key = normalizeSpaceKey(sp);
      const spId = sanitizeFirestoreId(sp.id, 'sp');
      if (cloudSpaces.has(spId) || seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);
      operations.push({
        type: 'space',
        refPath: 'campusSpaces',
        id: spId,
        payload: buildSpaceWritePayload(sp, buildingId, uid, displayName),
      });
      spacesSynced += 1;
    }
  }

  // Commit in chunks of 400 (well under Firestore's 500-op batch ceiling)
  for (let i = 0; i < operations.length; i += 400) {
    const chunk = operations.slice(i, i + 400);
    const batch = writeBatch(db);
    for (const op of chunk) {
      batch.set(doc(db, op.refPath, op.id), op.payload);
    }
    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'campusBuildings');
    }
  }

  // Ensure helper import setDoc remains cleanly typed/referenced if single doc needed
  void setDoc;

  return {buildingsSynced, spacesSynced};
}
