import {useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Download,
  FileSpreadsheet,
  ListChecks,
  LocateFixed,
  Map as MapIcon,
  Mic,
  MicOff,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  BuildingCategory,
  CampusBuildingEntry,
  CampusSpace,
  SpaceKind,
} from '../types/campus';
import {
  buildDirectoryCsvExport,
  buildDirectoryExportJson,
} from '../utils/campusStorage';

const planoAssets = import.meta.glob<string>(
  '../assets/*.{png,jpg,jpeg,webp}',
  {
    eager: true,
    query: '?inline',
    import: 'default',
  }
);
const bundledPlanoUrl = Object.values(planoAssets)[0] ?? null;

interface FieldSurveyPanelProps {
  buildings: CampusBuildingEntry[];
  onSaveBuildings: (updated: CampusBuildingEntry[]) => void;
  hasMapsKey: boolean;
  onExitSurvey?: () => void;
  onRequestMapPick?: () => void;
  pickedCoords?: {lat: number; lng: number} | null;
  onClearPickedCoords?: () => void;
  onFocusCoords?: (coords: {lat: number; lng: number}, zoom?: number) => void;
}

type CapturePhase = 'walk' | 'details';
type EntryTargetKind = SpaceKind | 'Edificio';
type DrawerView = 'none' | 'map' | 'records';

interface SpeechRecognitionResultLike {
  readonly length: number;
  [index: number]: {readonly transcript: string};
}

interface SpeechRecognitionEventLike {
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

const CATEGORIES: BuildingCategory[] = [
  'Académico',
  'Laboratorios',
  'Administrativo',
  'Biblioteca e Información',
  'Deporte y Cultura',
  'Servicios Estudiantiles',
];

const ENTRY_KINDS: Array<{value: EntryTargetKind; label: string}> = [
  {value: 'Aula', label: 'Aula / Salón'},
  {value: 'Laboratorio', label: 'Laboratorio'},
  {value: 'Oficina', label: 'Oficina'},
  {value: 'Edificio', label: 'Edificio'},
  {value: 'Servicio', label: 'Servicio'},
  {value: 'Auditorio', label: 'Auditorio'},
];

const QUICK_FLOORS = ['Planta Baja', 'Piso 1', 'Piso 2', 'Piso 3'];

const SURVEYOR_STORAGE_KEY = 'itd_surveyor_name_v1';

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function FieldSurveyPanel({
  buildings,
  onSaveBuildings,
  hasMapsKey,
  onExitSurvey,
  onRequestMapPick,
  pickedCoords,
  onClearPickedCoords,
  onFocusCoords,
}: FieldSurveyPanelProps) {
  const [phase, setPhase] = useState<CapturePhase>(() =>
    pickedCoords ? 'details' : 'walk'
  );
  const [drawerView, setDrawerView] = useState<DrawerView>('none');

  const [surveyorName, setSurveyorName] = useState<string>(() => {
    try {
      return localStorage.getItem(SURVEYOR_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const [targetBuildingId, setTargetBuildingId] = useState<string>(
    () => buildings[0]?.id ?? '__new__'
  );
  const [newBuildingCode, setNewBuildingCode] = useState('');
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newBuildingCategory, setNewBuildingCategory] =
    useState<BuildingCategory>('Académico');

  const [gpsCoords, setGpsCoords] = useState<{
    lat: number;
    lng: number;
    accuracy?: number;
  } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [entryKind, setEntryKind] = useState<EntryTargetKind>('Aula');
  const [spaceCode, setSpaceCode] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [spaceFloor, setSpaceFloor] = useState('Planta Baja');
  const [spaceSchedule, setSpaceSchedule] = useState('');
  const [spaceNotes, setSpaceNotes] = useState('');
  const [showExtras, setShowExtras] = useState(false);

  const [lastSavedNotice, setLastSavedNotice] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [planoZoomed, setPlanoZoomed] = useState(false);
  const [planoLoadError, setPlanoLoadError] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const speechSupported = useMemo(() => Boolean(getSpeechRecognitionCtor()), []);
  const activeCoords = pickedCoords ?? gpsCoords;

  useEffect(() => {
    if (pickedCoords) {
      setPhase('details');
      setDrawerView('none');
    }
  }, [pickedCoords]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const selectedBuilding = useMemo(
    () => buildings.find((b) => b.id === targetBuildingId) ?? null,
    [buildings, targetBuildingId]
  );

  const stats = useMemo(() => {
    let totalSpaces = 0;
    let pinnedBuildings = 0;
    for (const b of buildings) {
      totalSpaces += b.spaces.length;
      if (b.customLatLng) pinnedBuildings += 1;
    }
    return {
      totalBuildings: buildings.length,
      totalSpaces,
      pinnedBuildings,
    };
  }, [buildings]);

  const triggerGpsCapture = () => {
    if (!navigator.geolocation) {
      setGpsError('Tu navegador no soporta GPS. Puedes guardar los datos manualmente.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    onClearPickedCoords?.();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        const captured = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        };
        setGpsCoords(captured);
        onFocusCoords?.({lat: captured.lat, lng: captured.lng}, 19);
      },
      (err) => {
        setGpsLoading(false);
        setGpsError(
          err.code === 1
            ? 'Permiso de GPS denegado. Activa la ubicación en tu navegador o continúa sin GPS.'
            : 'Señal GPS débil en interiores. Puedes reintentar o guardar sin coordenada.'
        );
      },
      {enableHighAccuracy: true, maximumAge: 0, timeout: 15000}
    );
  };

  const handleStartMarkPoint = () => {
    setLastSavedNotice(null);
    setDrawerView('none');
    setPhase('details');
    triggerGpsCapture();
  };

  const handleManualEntryWithoutGps = () => {
    setLastSavedNotice(null);
    setDrawerView('none');
    setGpsError(null);
    setPhase('details');
  };

  const handleToggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = 'es-MX';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setSpaceName((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  const handleSaveAndContinue = (e: React.FormEvent) => {
    e.preventDefault();

    if (surveyorName.trim()) {
      localStorage.setItem(SURVEYOR_STORAGE_KEY, surveyorName.trim());
    }

    const today = new Date().toISOString().slice(0, 10);
    const isBuildingOnly = entryKind === 'Edificio';
    const hasSpaceInput =
      !isBuildingOnly &&
      (spaceName.trim().length > 0 || spaceCode.trim().length > 0);

    const newSpace: CampusSpace | null = hasSpaceInput
      ? {
          id: `sp-${Date.now().toString(36)}`,
          code: spaceCode.trim() || 'S/N',
          name: spaceName.trim() || `${entryKind} ${spaceCode.trim()}`,
          kind: entryKind as SpaceKind,
          floor: spaceFloor.trim() || 'Planta Baja',
          schedule: spaceSchedule.trim() || undefined,
          notes: spaceNotes.trim() || undefined,
        }
      : null;

    let savedSummary = '';

    if (targetBuildingId === '__new__') {
      if (!newBuildingName.trim()) return;
      const slug =
        newBuildingName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') || Date.now().toString(36);

      const newEntry: CampusBuildingEntry = {
        id: `itd-${slug}`,
        code: newBuildingCode.trim() || 'ITD',
        name: newBuildingName.trim(),
        category: newBuildingCategory,
        description: `Registrado en levantamiento de campo${
          surveyorName.trim() ? ` por ${surveyorName.trim()}` : ''
        }.`,
        matchKeywords: [newBuildingName.trim().toLowerCase()],
        customLatLng: activeCoords
          ? {lat: activeCoords.lat, lng: activeCoords.lng}
          : null,
        updatedBy: surveyorName.trim() || 'Brigada Servicio Social',
        updatedAt: today,
        spaces: newSpace ? [newSpace] : [],
      };

      onSaveBuildings([...buildings, newEntry]);
      setTargetBuildingId(newEntry.id);
      setNewBuildingCode('');
      setNewBuildingName('');
      savedSummary = newSpace
        ? `${newSpace.kind} ${newSpace.code} en ${newEntry.code}`
        : `Edificio ${newEntry.code} — ${newEntry.name}`;
    } else {
      const target = buildings.find((b) => b.id === targetBuildingId);
      const updated = buildings.map((b) => {
        if (b.id !== targetBuildingId) return b;
        return {
          ...b,
          customLatLng: activeCoords
            ? {lat: activeCoords.lat, lng: activeCoords.lng}
            : b.customLatLng,
          updatedBy: surveyorName.trim() || b.updatedBy,
          updatedAt: today,
          spaces: newSpace ? [...b.spaces, newSpace] : b.spaces,
        };
      });
      onSaveBuildings(updated);
      savedSummary = newSpace
        ? `${newSpace.kind} ${newSpace.code} en ${target?.code ?? 'ITD'}`
        : `GPS guardado en ${target?.code ?? 'edificio'}`;
    }

    recognitionRef.current?.stop();
    setIsListening(false);
    setSpaceCode('');
    setSpaceName('');
    setSpaceSchedule('');
    setSpaceNotes('');
    setGpsCoords(null);
    setGpsError(null);
    onClearPickedCoords?.();
    setShowExtras(false);
    setLastSavedNotice(`${savedSummary}. Listo para el siguiente punto.`);
    setPhase('walk');
  };

  const handleDeleteSpace = (buildingId: string, spaceId: string) => {
    const updated = buildings.map((b) => {
      if (b.id !== buildingId) return b;
      return {
        ...b,
        spaces: b.spaces.filter((sp) => sp.id !== spaceId),
      };
    });
    onSaveBuildings(updated);
  };

  const handleDownloadCsv = () => {
    const csv = buildDirectoryCsvExport(buildings);
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `levantamiento-itd-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    const json = buildDirectoryExportJson(buildings);
    const blob = new Blob([json], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campus-directory.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 px-4 py-5 md:py-8">
      <div className="mx-auto w-full max-w-xl pb-8">
        {/* Single Focused Card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Card Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-900 md:text-lg">
                Brigada GPS · Campus ITD
              </h1>
              <p className="font-mono-tabular mt-0.5 text-xs text-slate-500">
                {stats.totalBuildings} edificios · {stats.totalSpaces} aulas/áreas ·{' '}
                {stats.pinnedBuildings} con GPS
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleDownloadCsv}
                title="Descargar Excel (CSV)"
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={handleDownloadJson}
                title="Descargar JSON"
                className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                JSON
              </button>
              {hasMapsKey && onExitSurvey && (
                <button
                  type="button"
                  onClick={onExitSurvey}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Mapa
                </button>
              )}
            </div>
          </div>

          {/* Secondary Compact Tools Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 sm:px-5">
            <div className="flex min-w-[160px] flex-1 items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-500 whitespace-nowrap">
                Brigadista:
              </span>
              <input
                type="text"
                value={surveyorName}
                onChange={(e) => {
                  setSurveyorName(e.target.value);
                  localStorage.setItem(SURVEYOR_STORAGE_KEY, e.target.value);
                }}
                placeholder="Tu nombre (opcional)"
                className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#6F1D3A] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setPlanoLoadError(false);
                  setPlanoZoomed(false);
                  setDrawerView((v) => (v === 'map' ? 'none' : 'map'));
                }}
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  drawerView === 'map'
                    ? 'border-[#6F1D3A] bg-[#6F1D3A] text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" />
                Plano ITD
              </button>
              <button
                type="button"
                onClick={() =>
                  setDrawerView((v) => (v === 'records' ? 'none' : 'records'))
                }
                className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                  drawerView === 'records'
                    ? 'border-[#6F1D3A] bg-[#6F1D3A] text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                <ListChecks className="h-3.5 w-3.5" />
                Registros
              </button>
            </div>
          </div>

          {/* Optional Records Drawer */}
          {drawerView === 'records' && (
            <div className="max-h-[400px] overflow-y-auto border-b border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">
                  Registros capturados en este dispositivo
                </span>
                <button
                  type="button"
                  onClick={() => setDrawerView('none')}
                  className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                {buildings.map((b) => (
                  <div key={b.id} className="px-3.5 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        <span className="font-mono-tabular mr-1.5 text-[#6F1D3A]">
                          {b.code}
                        </span>
                        {b.name}
                      </span>
                      <span className="font-mono-tabular shrink-0 text-[11px] text-slate-500">
                        {b.customLatLng
                          ? `${b.customLatLng.lat.toFixed(5)}, ${b.customLatLng.lng.toFixed(5)}`
                          : 'Sin GPS'}
                      </span>
                    </div>
                    {b.spaces.length > 0 && (
                      <div className="mt-1.5 space-y-1 border-t border-slate-100 pt-1.5">
                        {b.spaces.map((sp) => (
                          <div
                            key={sp.id}
                            className="flex items-center justify-between gap-2 text-[11px] text-slate-600"
                          >
                            <span>
                              <strong className="font-mono-tabular text-slate-800">
                                {sp.code}
                              </strong>{' '}
                              · {sp.name} · {sp.floor}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteSpace(b.id, sp.id)}
                              title="Eliminar registro"
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PHASE 1: WALK & TAP */}
          {phase === 'walk' && (
            <div className="space-y-5 p-5 md:p-6">
              {lastSavedNotice && (
                <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-900">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                  <span>{lastSavedNotice}</span>
                </div>
              )}

              {/* Current Building Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Edificio actual donde estás caminando
                </label>
                <select
                  value={targetBuildingId}
                  onChange={(e) => setTargetBuildingId(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-medium text-slate-900 focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
                >
                  <option value="__new__">+ Registrar nuevo edificio</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
                {selectedBuilding && (
                  <p className="font-mono-tabular mt-1.5 text-[11px] text-slate-500">
                    {selectedBuilding.spaces.length} áreas registradas ·{' '}
                    {selectedBuilding.customLatLng
                      ? `GPS: ${selectedBuilding.customLatLng.lat.toFixed(5)}, ${selectedBuilding.customLatLng.lng.toFixed(5)}`
                      : 'Aún sin coordenada GPS'}
                  </p>
                )}
              </div>

              {/* Primary Big Walk & Tap Button */}
              <button
                type="button"
                onClick={handleStartMarkPoint}
                className="flex min-h-[88px] w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#6F1D3A] px-6 py-5 text-white shadow-sm transition-colors hover:bg-[#58162d] active:scale-[0.99]"
              >
                <div className="flex items-center gap-2.5 text-base font-bold md:text-lg">
                  <LocateFixed className="h-6 w-6" />
                  Marcar punto aquí (Capturar GPS)
                </div>
                <span className="text-xs font-normal text-white/85">
                  Presiona frente al salón, laboratorio o entrada y luego
                  escribe o dicta el nombre
                </span>
              </button>

              {/* Secondary Manual / Map Actions */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleManualEntryWithoutGps}
                  className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Capturar datos sin GPS
                </button>
                {hasMapsKey && onRequestMapPick && (
                  <button
                    type="button"
                    onClick={onRequestMapPick}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    Marcar en el mapa
                  </button>
                )}
              </div>
            </div>
          )}

          {/* PHASE 2: QUICK INFO CAPTURE */}
          {phase === 'details' && (
            <form onSubmit={handleSaveAndContinue} className="space-y-4 p-5 md:p-6">
              {/* Live GPS Lock Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                <div className="min-w-0 flex-1">
                  {gpsLoading ? (
                    <span className="text-xs font-semibold text-slate-700">
                      Obteniendo coordenada GPS... (puedes llenar los datos
                      mientras tanto)
                    </span>
                  ) : activeCoords ? (
                    <div className="font-mono-tabular text-xs font-semibold text-emerald-800">
                      GPS fijado: {activeCoords.lat.toFixed(6)},{' '}
                      {activeCoords.lng.toFixed(6)}
                      {'accuracy' in activeCoords && activeCoords.accuracy
                        ? ` · ±${activeCoords.accuracy} m`
                        : ''}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-600">
                      {gpsError ?? 'Sin coordenada GPS fijada en este punto'}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={triggerGpsCapture}
                  disabled={gpsLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                  {gpsLoading ? 'Buscando...' : 'Recapturar'}
                </button>
              </div>

              {/* Building Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Edificio
                </label>
                <select
                  value={targetBuildingId}
                  onChange={(e) => setTargetBuildingId(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
                >
                  <option value="__new__">+ Registrar nuevo edificio</option>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} — {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {targetBuildingId === '__new__' && (
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-700">
                      Clave
                    </label>
                    <input
                      type="text"
                      required
                      value={newBuildingCode}
                      onChange={(e) => setNewBuildingCode(e.target.value)}
                      placeholder="Ej. SC"
                      className="font-mono-tabular mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs font-semibold text-slate-700">
                      Nombre del edificio
                    </label>
                    <input
                      type="text"
                      required
                      value={newBuildingName}
                      onChange={(e) => setNewBuildingName(e.target.value)}
                      placeholder="Ej. Sistemas y Computación"
                      className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700">
                      Categoría
                    </label>
                    <select
                      value={newBuildingCategory}
                      onChange={(e) =>
                        setNewBuildingCategory(
                          e.target.value as BuildingCategory
                        )
                      }
                      className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* One-tap Type Selection */}
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  ¿Qué punto estás registrando?
                </label>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {ENTRY_KINDS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setEntryKind(item.value)}
                      className={`min-h-[42px] rounded-xl border px-2.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                        entryKind === item.value
                          ? 'border-[#6F1D3A] bg-[#6F1D3A] text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Room / Lab / Office Inputs */}
              {entryKind !== 'Edificio' && (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-700">
                        Número o clave
                      </label>
                      <input
                        type="text"
                        value={spaceCode}
                        onChange={(e) => setSpaceCode(e.target.value)}
                        placeholder="Ej. SC-101"
                        className="font-mono-tabular mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#6F1D3A] focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-700">
                          Nombre del lugar
                        </label>
                        {speechSupported && (
                          <button
                            type="button"
                            onClick={handleToggleVoice}
                            className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                              isListening
                                ? 'bg-red-600 text-white'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            }`}
                          >
                            {isListening ? (
                              <>
                                <MicOff className="h-3 w-3" />
                                Escuchando...
                              </>
                            ) : (
                              <>
                                <Mic className="h-3 w-3" />
                                Dictar por voz
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        value={spaceName}
                        onChange={(e) => setSpaceName(e.target.value)}
                        placeholder="Ej. Aula 101 / Lab. Redes / Jefatura"
                        className="mt-1 min-h-[44px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-[#6F1D3A] focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Quick Floor Chips */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700">
                      Nivel / Piso
                    </label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {QUICK_FLOORS.map((fl) => (
                        <button
                          key={fl}
                          type="button"
                          onClick={() => setSpaceFloor(fl)}
                          className={`min-h-[38px] rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                            spaceFloor === fl
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {fl}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Collapsible Extras */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowExtras((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                    >
                      {showExtras ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      {showExtras
                        ? 'Ocultar horario y notas'
                        : 'Agregar horario o referencia (opcional)'}
                    </button>

                    {showExtras && (
                      <div className="mt-2 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        <input
                          type="text"
                          value={spaceSchedule}
                          onChange={(e) => setSpaceSchedule(e.target.value)}
                          placeholder="Horario (ej. L-V 08:00 - 15:00)"
                          className="min-h-[40px] rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        />
                        <input
                          type="text"
                          value={spaceNotes}
                          onChange={(e) => setSpaceNotes(e.target.value)}
                          placeholder="Referencia (ej. Junto a escaleras)"
                          className="min-h-[40px] rounded-lg border border-slate-200 px-3 py-2 text-xs"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Bottom Primary Actions */}
              <div className="flex items-center gap-3 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    recognitionRef.current?.stop();
                    setIsListening(false);
                    setPhase('walk');
                  }}
                  className="min-h-[48px] rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="min-h-[48px] flex-1 rounded-xl bg-[#6F1D3A] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#58162d]"
                >
                  Guardar y seguir caminando
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Fullscreen Mobile-Friendly Plano Modal */}
      {drawerView === 'map' && (
        <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 text-white">
            <span className="truncate text-xs font-bold sm:text-sm">
              Plano oficial ITD — Unidades Académicas
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPlanoZoomed((z) => !z)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 whitespace-nowrap"
              >
                {planoZoomed ? (
                  <>
                    <ZoomOut className="h-3.5 w-3.5" />
                    Ajustar
                  </>
                ) : (
                  <>
                    <ZoomIn className="h-3.5 w-3.5" />
                    Ampliar
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setDrawerView('none')}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[#6F1D3A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#58162d] whitespace-nowrap"
              >
                <X className="h-4 w-4" />
                Cerrar
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-3">
            <div
              className={
                planoZoomed
                  ? 'min-w-[820px] pb-6'
                  : 'flex min-h-full items-center justify-center'
              }
            >
              {bundledPlanoUrl && !planoLoadError ? (
                <img
                  src={bundledPlanoUrl}
                  alt="Plano oficial de unidades académicas del Instituto Tecnológico de Durango"
                  onError={() => setPlanoLoadError(true)}
                  className={
                    planoZoomed
                      ? 'mx-auto w-full rounded-lg bg-white object-contain'
                      : 'mx-auto max-h-full w-full max-w-3xl rounded-lg bg-white object-contain'
                  }
                />
              ) : (
                <ItdPlanoFallback zoomed={planoZoomed} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItdPlanoFallback({zoomed = false}: {zoomed?: boolean}) {
  return (
    <div
      className={`mx-auto overflow-hidden rounded-lg border border-slate-300 bg-white text-slate-900 shadow-sm ${
        zoomed ? 'w-full' : 'w-full max-w-3xl'
      }`}
    >
      <svg
        viewBox="0 0 960 980"
        className="block h-auto w-full select-none"
        role="img"
        aria-label="Plano detallado de unidades académicas del Instituto Tecnológico de Durango"
      >
        <defs>
          <pattern
            id="pavingGrid"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 6 0 L 0 0 0 6"
              fill="none"
              stroke="#DC2626"
              strokeWidth="0.35"
              strokeOpacity="0.28"
            />
          </pattern>
          <pattern
            id="parkingStripeV"
            width="10"
            height="5"
            patternUnits="userSpaceOnUse"
          >
            <rect width="8" height="3.2" fill="#EA580C" />
          </pattern>
          <pattern
            id="parkingStripeH"
            width="5"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <rect width="3.2" height="8" fill="#EA580C" />
          </pattern>
        </defs>

        {/* Top Banner */}
        <rect x="0" y="0" width="960" height="50" fill="#5D162F" />
        <text
          x="480"
          y="33"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="24"
          fontWeight="700"
          letterSpacing="4"
        >
          INSTITUTO TECNOLÓGICO DE DURANGO
        </text>

        {/* Main White Canvas */}
        <rect x="0" y="50" width="960" height="880" fill="#FFFFFF" />

        {/* ==================== UNIDAD NORTE ==================== */}
        {/* Av. Jesús García & Top Bays */}
        <path
          d="M 145 78 L 145 96 L 265 96 L 265 78 M 275 78 L 275 96 L 405 96 L 405 78 M 415 78 L 415 96 L 545 96 L 545 78 M 555 78 L 555 96 L 835 96 L 835 78"
          fill="none"
          stroke="#1E293B"
          strokeWidth="1.8"
        />
        <text
          x="365"
          y="120"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="11"
          fontWeight="700"
        >
          AV. JESÚS GARCÍA
        </text>
        <text x="688" y="128" fill="#334155" fontSize="6.5" fontWeight="700">
          ACCESO
        </text>
        <text x="765" y="131" fill="#334155" fontSize="6.5" fontWeight="700">
          SALIDA
        </text>

        {/* Unidad Norte Outer Boundary */}
        <path
          d="M 122 135 L 866 135 L 866 418 L 210 416 Q 192 385 182 340 L 122 135 Z"
          fill="#FFFFFF"
          stroke="#0F172A"
          strokeWidth="2.4"
        />

        {/* Blvd. Tecnológico road line */}
        <path
          d="M 102 135 L 178 398 Q 186 418 212 420"
          fill="none"
          stroke="#0F172A"
          strokeWidth="2"
        />
        <text
          x="136"
          y="235"
          fill="#0F172A"
          fontSize="9.5"
          fontWeight="700"
          transform="rotate(73 136 235)"
        >
          BLVD. TECNOLÓGICO
        </text>

        {/* Internal Ring Road (Unidad Norte) */}
        <path
          d="M 185 322 L 260 282 L 568 282 Q 596 282 596 254 L 596 135"
          fill="none"
          stroke="#0F172A"
          strokeWidth="1.8"
        />
        <path
          d="M 192 338 L 266 300 L 580 300 Q 614 300 614 260 L 614 135"
          fill="none"
          stroke="#0F172A"
          strokeWidth="1.8"
        />

        {/* North-West Field: m, i, Campo de Beisbol */}
        <rect
          x="232"
          y="178"
          width="66"
          height="32"
          fill="#FFFFFF"
          stroke="#64748B"
          strokeWidth="1.8"
        />
        <text x="265" y="198" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="600">
          m
        </text>

        <g transform="translate(178, 224) rotate(24)">
          <rect
            x="-6"
            y="-6"
            width="86"
            height="36"
            fill="#16A34A"
            fillOpacity="0.14"
            stroke="#86EFAC"
            strokeWidth="1"
          />
          <polygon
            points="0,6 22,6 32,0 52,0 74,10 74,22 48,22 38,16 20,22 0,22"
            fill="#FFFFFF"
            stroke="#475569"
            strokeWidth="1.4"
          />
          <text x="37" y="15" textAnchor="middle" fill="#334155" fontSize="9.5" fontWeight="600">
            i
          </text>
        </g>

        {/* Trees North-West */}
        <circle cx="152" cy="175" r="7" fill="#16A34A" />
        <circle cx="164" cy="170" r="6" fill="#16A34A" />
        <circle cx="156" cy="186" r="6" fill="#16A34A" />
        <circle cx="168" cy="232" r="7" fill="#16A34A" />
        <circle cx="176" cy="242" r="6" fill="#16A34A" />

        {/* Campo de Beisbol */}
        <path
          d="M 358 278 Q 465 268 475 137"
          fill="none"
          stroke="#94A3B8"
          strokeWidth="1.6"
        />
        <text x="394" y="216" fill="#0F172A" fontSize="9" fontWeight="700">
          Campo de Beisbol
        </text>

        {/* Parking South-West (Unidad Norte) */}
        <rect
          x="196"
          y="338"
          width="116"
          height="74"
          rx="4"
          fill="#FFF7ED"
          stroke="#CBD5E1"
          strokeWidth="1"
        />
        {[206, 222, 238, 254, 270, 286, 300].map((px) => (
          <rect
            key={px}
            x={px}
            y="344"
            width="9"
            height="56"
            fill="url(#parkingStripeV)"
          />
        ))}
        <rect x="234" y="404" width="66" height="6" fill="url(#parkingStripeH)" />

        {/* Courtyard & Building h */}
        <rect
          x="318"
          y="304"
          width="102"
          height="92"
          fill="url(#pavingGrid)"
          stroke="#CBD5E1"
          strokeWidth="0.8"
        />
        <rect x="318" y="304" width="22" height="58" fill="#16A34A" fillOpacity="0.24" />
        <path
          d="M 342 308 L 386 308 L 386 322 L 396 322 L 396 364 L 386 364 L 386 376 L 342 362 Z"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.6"
        />
        <text x="366" y="344" textAnchor="middle" fill="#334155" fontSize="11" fontWeight="700">
          h
        </text>

        {/* Trees along Blvd. Felipe Pescador (Unidad Norte) */}
        {[428, 444, 460, 476, 492, 510, 526, 542, 558, 574].map((tx, idx) => (
          <circle
            key={tx}
            cx={tx}
            cy={idx % 2 === 0 ? 396 : 390}
            r="6.5"
            fill="#16A34A"
          />
        ))}

        {/* Paved Plaza around EE / UTD / Industrial / MM */}
        <rect
          x="588"
          y="246"
          width="84"
          height="138"
          fill="url(#pavingGrid)"
        />

        {/* SC Building */}
        <rect
          x="508"
          y="164"
          width="70"
          height="32"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.8"
        />
        <text x="543" y="177" textAnchor="middle" fill="#0F172A" fontSize="7.2" fontWeight="700">
          SISTEMAS Y
        </text>
        <text x="543" y="185" textAnchor="middle" fill="#0F172A" fontSize="7.2" fontWeight="700">
          COMPUTACIÓN
        </text>
        <text x="543" y="193" textAnchor="middle" fill="#334155" fontSize="7" fontWeight="700">
          aulas SC
        </text>

        {/* QB Building */}
        <rect
          x="492"
          y="214"
          width="70"
          height="32"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.8"
        />
        <text x="527" y="227" textAnchor="middle" fill="#0F172A" fontSize="7.2" fontWeight="700">
          QUÍMICA Y
        </text>
        <text x="527" y="235" textAnchor="middle" fill="#0F172A" fontSize="7.2" fontWeight="700">
          BIOQUÍMICA
        </text>
        <text x="527" y="243" textAnchor="middle" fill="#334155" fontSize="7" fontWeight="700">
          aulas QB
        </text>

        {/* EE + Domo + UTD + Industrial + MM */}
        <rect
          x="618"
          y="148"
          width="62"
          height="34"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.8"
        />
        <text x="649" y="160" textAnchor="middle" fill="#0F172A" fontSize="7.5" fontWeight="700">
          ELÉCTRICA Y
        </text>
        <text x="649" y="169" textAnchor="middle" fill="#0F172A" fontSize="7.5" fontWeight="700">
          ELECTRÓNICA
        </text>
        <text x="649" y="178" textAnchor="middle" fill="#334155" fontSize="7" fontWeight="700">
          aulas EE 1-14
        </text>

        <rect
          x="618"
          y="182"
          width="62"
          height="36"
          fill="#64748B"
          stroke="#334155"
          strokeWidth="1.2"
        />
        <text x="649" y="204" textAnchor="middle" fill="#FFFFFF" fontSize="9" fontWeight="700">
          Domo
        </text>

        <rect
          x="618"
          y="218"
          width="62"
          height="30"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.8"
        />
        <text x="649" y="231" textAnchor="middle" fill="#0F172A" fontSize="7.8" fontWeight="700">
          DISTANCIA
        </text>
        <text x="649" y="242" textAnchor="middle" fill="#334155" fontSize="7" fontWeight="700">
          aulas UTD 1-9
        </text>

        <rect
          x="618"
          y="286"
          width="62"
          height="32"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.8"
        />
        <text x="649" y="300" textAnchor="middle" fill="#0F172A" fontSize="7.8" fontWeight="700">
          INDUSTRIAL
        </text>
        <text x="649" y="311" textAnchor="middle" fill="#334155" fontSize="7" fontWeight="700">
          aulas I 1-12
        </text>

        <rect
          x="582"
          y="344"
          width="68"
          height="34"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.8"
        />
        <text x="616" y="356" textAnchor="middle" fill="#0F172A" fontSize="7.2" fontWeight="700">
          MECÁNICA Y
        </text>
        <text x="616" y="365" textAnchor="middle" fill="#0F172A" fontSize="7.2" fontWeight="700">
          MECATRÓNICA
        </text>
        <text x="616" y="374" textAnchor="middle" fill="#334155" fontSize="7" fontWeight="700">
          aulas MM
        </text>

        {/* East Sector Unidad Norte: Gardens, Walkways, e, c, k, b, d, a & Parking */}
        {/* Parking East of Domo / UTD */}
        <rect x="688" y="152" width="76" height="12" fill="url(#parkingStripeH)" />
        <rect x="688" y="176" width="76" height="10" fill="url(#parkingStripeH)" />
        <rect x="782" y="192" width="12" height="44" fill="url(#parkingStripeV)" />
        <rect x="854" y="150" width="8" height="205" fill="url(#parkingStripeV)" />

        {/* Building e */}
        <rect
          x="708"
          y="196"
          width="54"
          height="38"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.6"
        />
        <text x="735" y="219" textAnchor="middle" fill="#334155" fontSize="10" fontWeight="600">
          e
        </text>

        {/* Court / Building c (right side) */}
        <rect
          x="814"
          y="174"
          width="32"
          height="62"
          rx="12"
          fill="#FFFFFF"
          stroke="#64748B"
          strokeWidth="1.4"
        />
        <rect
          x="819"
          y="182"
          width="22"
          height="46"
          fill="none"
          stroke="#94A3B8"
          strokeWidth="1"
        />
        <circle cx="830" cy="205" r="5" fill="none" stroke="#94A3B8" strokeWidth="1" />
        <text x="830" y="208" textAnchor="middle" fill="#334155" fontSize="9" fontWeight="600">
          c
        </text>

        {/* Green Garden Islands & Tan Walkways (South-East Unidad Norte) */}
        <path
          d="M 652 380 Q 690 340 735 330 Q 795 315 848 395 L 652 414 Z"
          fill="url(#pavingGrid)"
        />
        <path
          d="M 686 254 Q 730 245 752 268 Q 760 296 726 306 Q 692 308 686 278 Z"
          fill="#16A34A"
        />
        <path
          d="M 744 276 Q 778 272 794 298 Q 798 326 764 334 Q 732 328 744 276 Z"
          fill="#16A34A"
        />
        <path
          d="M 758 340 Q 792 332 802 362 Q 798 396 758 394 Q 740 374 758 340 Z"
          fill="#16A34A"
        />
        <path
          d="M 672 356 Q 704 348 724 374 Q 726 404 686 406 Q 658 392 672 356 Z"
          fill="#16A34A"
        />

        {/* Building d (diamond inside garden) */}
        <g transform="translate(712, 326) rotate(42)">
          <rect
            x="-15"
            y="-14"
            width="30"
            height="28"
            fill="#FFFFFF"
            stroke="#475569"
            strokeWidth="1.5"
          />
          <text
            x="0"
            y="4"
            textAnchor="middle"
            fill="#334155"
            fontSize="9"
            fontWeight="600"
            transform="rotate(-42)"
          >
            d
          </text>
        </g>

        {/* Building k, b, a */}
        <polygon
          points="772,248 794,244 800,268 776,272"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.4"
        />
        <text x="786" y="261" textAnchor="middle" fill="#334155" fontSize="9" fontWeight="600">
          k
        </text>

        <g transform="translate(808, 294) rotate(-38)">
          <rect
            x="-18"
            y="-13"
            width="36"
            height="26"
            fill="#FFFFFF"
            stroke="#475569"
            strokeWidth="1.5"
          />
          <text
            x="0"
            y="4"
            textAnchor="middle"
            fill="#334155"
            fontSize="9"
            fontWeight="600"
            transform="rotate(38)"
          >
            b
          </text>
        </g>

        <g transform="translate(838, 372) rotate(-35)">
          <rect
            x="-15"
            y="-12"
            width="30"
            height="24"
            fill="#FFFFFF"
            stroke="#475569"
            strokeWidth="1.5"
          />
          <text
            x="0"
            y="4"
            textAnchor="middle"
            fill="#334155"
            fontSize="9"
            fontWeight="600"
            transform="rotate(35)"
          >
            a
          </text>
        </g>

        {/* CFE label */}
        <text
          x="878"
          y="272"
          textAnchor="middle"
          fill="#334155"
          fontSize="8.5"
          fontWeight="600"
          transform="rotate(-90 878 272)"
        >
          COMISIÓN FEDERAL DE ELECTRICIDAD
        </text>

        {/* Unidad Norte Callout Pins */}
        <line x1="484" y1="126" x2="522" y2="168" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="478" cy="116" r="22" fill="#5D162F" />
        <text x="478" y="123" textAnchor="middle" fill="#FFFFFF" fontSize="16" fontWeight="700">
          SC
        </text>

        <line x1="472" y1="200" x2="500" y2="220" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="464" cy="196" r="22" fill="#5D162F" />
        <text x="464" y="203" textAnchor="middle" fill="#FFFFFF" fontSize="16" fontWeight="700">
          QB
        </text>

        <line x1="598" y1="112" x2="634" y2="152" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="592" cy="102" r="22" fill="#5D162F" />
        <text x="592" y="109" textAnchor="middle" fill="#FFFFFF" fontSize="16" fontWeight="700">
          EE
        </text>

        <line x1="728" y1="118" x2="676" y2="230" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="734" cy="104" r="22" fill="#5D162F" />
        <text x="734" y="110" textAnchor="middle" fill="#FFFFFF" fontSize="14" fontWeight="700">
          UTD
        </text>

        <line x1="896" y1="302" x2="674" y2="302" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="912" cy="302" r="22" fill="#5D162F" />
        <text x="912" y="309" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontWeight="700">
          I
        </text>

        <line x1="896" y1="396" x2="646" y2="360" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="912" cy="400" r="22" fill="#5D162F" />
        <text x="912" y="406" textAnchor="middle" fill="#FFFFFF" fontSize="15" fontWeight="700">
          MM
        </text>

        {/* Compass Rose (Norte) */}
        <g transform="translate(88, 360)">
          <text x="0" y="-58" textAnchor="middle" fill="#475569" fontSize="9.5" fontWeight="600">
            LIVERPOOL
          </text>
          <circle cx="0" cy="0" r="32" fill="none" stroke="#1E293B" strokeWidth="1.5" />
          <line x1="0" y1="-44" x2="0" y2="86" stroke="#1E293B" strokeWidth="1.5" />
          <line x1="-42" y1="0" x2="42" y2="0" stroke="#1E293B" strokeWidth="1.5" />
          <path d="M -32 0 L 0 -34 L 32 0" fill="none" stroke="#1E293B" strokeWidth="1.5" />
          <text x="9" y="54" fill="#1E293B" fontSize="20" fontWeight="500">
            norte
          </text>
        </g>

        {/* ==================== BLVD. FELIPE PESCADOR ==================== */}
        <line x1="198" y1="424" x2="808" y2="430" stroke="#0F172A" strokeWidth="2.4" />
        <line x1="214" y1="440" x2="804" y2="446" stroke="#0F172A" strokeWidth="2.4" />
        <text x="536" y="436" textAnchor="middle" fill="#0F172A" fontSize="10" fontWeight="700">
          BLVD. FELIPE PESCADOR
        </text>

        {/* ==================== UNIDAD SUR ==================== */}
        {/* Outer Boundary Unidad Sur */}
        <path
          d="M 222 452 L 802 452 L 814 584 L 722 606 L 758 754 L 464 888 L 222 452 Z"
          fill="#FFFFFF"
          stroke="#0F172A"
          strokeWidth="2.4"
        />

        {/* West Internal Green Strip & Central Avenue */}
        <polygon
          points="330,456 382,456 508,856 456,878"
          fill="#16A34A"
          fillOpacity="0.9"
        />
        {/* Internal North-South Road separating Aulas U/H/G/W/V/X/R/Q/K from I/J/Estadio */}
        <line x1="286" y1="454" x2="438" y2="878" stroke="#0F172A" strokeWidth="1.8" />
        <line x1="296" y1="454" x2="448" y2="872" stroke="#0F172A" strokeWidth="1.8" />

        {/* Green Zone West of Internal Road (W, V, Y, X, B, R, Q, K, C) */}
        <polygon
          points="300,536 336,536 446,858 412,870"
          fill="#16A34A"
          fillOpacity="0.88"
        />

        {/* Top-West Aulas U 1-4 & H 1-3 */}
        <g transform="translate(268, 520) rotate(-22)">
          <rect x="0" y="0" width="46" height="17" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.6" />
          <text x="23" y="11" textAnchor="middle" fill="#0F172A" fontSize="6.8" fontWeight="700">
            aulas U 1-4
          </text>
        </g>
        <g transform="translate(280, 544) rotate(-22)">
          <rect x="0" y="0" width="46" height="16" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="23" y="10" textAnchor="middle" fill="#0F172A" fontSize="6.8" fontWeight="700">
            aulas H 1-3
          </text>
        </g>

        {/* West Corridor Buildings: G, W, V, Y, X, B2, B1, B, R, Q, K, C */}
        <g transform="translate(286, 566) rotate(-22)">
          <rect x="0" y="0" width="32" height="32" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="16" y="19" textAnchor="middle" fill="#0F172A" fontSize="9" fontWeight="700">G</text>
        </g>
        <g transform="translate(322, 598) rotate(-22)">
          <rect x="0" y="0" width="34" height="16" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="17" y="11" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="700">W</text>
        </g>
        <g transform="translate(316, 628) rotate(-22)">
          <rect x="0" y="0" width="28" height="30" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="14" y="18" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">V</text>
        </g>
        <g transform="translate(352, 616) rotate(-22)">
          <rect x="0" y="0" width="26" height="28" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="13" y="17" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">Y</text>
        </g>
        <g transform="translate(334, 672) rotate(-22)">
          <rect x="0" y="0" width="34" height="44" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="17" y="25" textAnchor="middle" fill="#0F172A" fontSize="9" fontWeight="700">X</text>
        </g>
        <g transform="translate(374, 662) rotate(-22)">
          <rect x="0" y="0" width="26" height="28" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="13" y="17" textAnchor="middle" fill="#0F172A" fontSize="7.5" fontWeight="700">B2</text>
        </g>
        <g transform="translate(388, 694) rotate(-22)">
          <rect x="0" y="0" width="24" height="18" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="12" y="12" textAnchor="middle" fill="#0F172A" fontSize="7.5" fontWeight="700">B1</text>
        </g>
        <g transform="translate(396, 718) rotate(-22)">
          <rect x="0" y="0" width="34" height="52" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="17" y="29" textAnchor="middle" fill="#0F172A" fontSize="9.5" fontWeight="700">B</text>
        </g>
        <g transform="translate(362, 742) rotate(-22)">
          <rect x="0" y="0" width="24" height="20" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="12" y="13" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="700">R</text>
        </g>
        <g transform="translate(370, 770) rotate(-22)">
          <rect x="0" y="0" width="28" height="30" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="14" y="18" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">Q</text>
        </g>
        <g transform="translate(384, 808) rotate(-22)">
          <rect x="0" y="0" width="28" height="22" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="14" y="14" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="700">K</text>
        </g>
        <g transform="translate(420, 796) rotate(-22)">
          <rect x="0" y="0" width="28" height="16" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="14" y="11" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="700">C</text>
        </g>

        {/* Central-North Buildings: I, J1, J, P */}
        <g transform="translate(342, 478) rotate(-22)">
          <rect x="0" y="0" width="34" height="28" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="17" y="17" textAnchor="middle" fill="#0F172A" fontSize="9" fontWeight="700">I</text>
        </g>
        <g transform="translate(378, 464) rotate(-22)">
          <rect x="0" y="0" width="16" height="14" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.4" />
          <text x="8" y="10" textAnchor="middle" fill="#0F172A" fontSize="6.5" fontWeight="700">J1</text>
        </g>
        <g transform="translate(358, 514) rotate(-22)">
          <rect x="0" y="0" width="36" height="26" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="18" y="16" textAnchor="middle" fill="#0F172A" fontSize="9" fontWeight="700">J</text>
        </g>
        <g transform="translate(390, 488) rotate(-22)">
          <rect x="0" y="0" width="14" height="36" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.3" />
          <text x="7" y="21" textAnchor="middle" fill="#334155" fontSize="7.5" fontWeight="700">P</text>
        </g>

        {/* Volleyball & Fronton courts north of Estadio */}
        <g transform="translate(412, 474) rotate(-20)">
          <rect x="0" y="0" width="46" height="26" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.2" />
          <text x="23" y="15" textAnchor="middle" fill="#475569" fontSize="4.8" fontWeight="600">
            VOLEIBOL PLAYA
          </text>
        </g>
        <g transform="translate(486, 458) rotate(-20)">
          <rect x="0" y="0" width="40" height="18" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.2" />
          <text x="20" y="11" textAnchor="middle" fill="#475569" fontSize="5.2" fontWeight="600">
            FRONTÓN
          </text>
        </g>

        {/* ESTADIO & Track */}
        <g transform="translate(502, 622) rotate(-21)">
          <rect
            x="-64"
            y="-108"
            width="128"
            height="216"
            rx="64"
            fill="#991B1B"
            stroke="#475569"
            strokeWidth="2"
          />
          <rect x="-42" y="-82" width="84" height="164" rx="14" fill="#16A34A" />
          <text x="0" y="4" textAnchor="middle" fill="#FFFFFF" fontSize="10.5" fontWeight="700">
            ESTADIO
          </text>
        </g>

        {/* Green strip east of Estadio + N & Z */}
        <polygon points="520,492 544,484 606,660 582,668" fill="#16A34A" />
        <g transform="translate(550, 524) rotate(-21)">
          <rect x="0" y="0" width="24" height="94" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.6" />
          <text x="12" y="51" textAnchor="middle" fill="#0F172A" fontSize="9.5" fontWeight="700">N</text>
        </g>
        <g transform="translate(592, 616) rotate(-21)">
          <rect x="0" y="0" width="24" height="24" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.5" />
          <text x="12" y="15" textAnchor="middle" fill="#0F172A" fontSize="9" fontWeight="700">Z</text>
        </g>

        {/* L, CANCHAS & Estacionamiento Oriente */}
        <g transform="translate(566, 480) rotate(-21)">
          <rect x="0" y="0" width="58" height="38" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.4" />
          <text x="29" y="23" textAnchor="middle" fill="#334155" fontSize="9.5" fontWeight="700">L</text>
        </g>
        <g transform="translate(612, 502) rotate(-21)">
          <rect x="0" y="0" width="54" height="72" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.3" />
          <text x="27" y="38" textAnchor="middle" fill="#475569" fontSize="7.5" fontWeight="700">
            CANCHAS
          </text>
        </g>

        {/* East Parking Lot (5 orange rows) */}
        {[482, 498, 514, 530, 546].map((py) => (
          <rect
            key={py}
            x="698"
            y={py}
            width="86"
            height="9"
            fill="url(#parkingStripeH)"
          />
        ))}

        {/* South Academic Wing: E, M, F, O 1-10, D 1-12, S 1-8, T 1-14, A, Plaza Cívica */}
        <g transform="translate(590, 668) rotate(-22)">
          <rect x="0" y="0" width="96" height="28" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.6" />
          <text x="45" y="18" textAnchor="middle" fill="#0F172A" fontSize="9.5" fontWeight="700">E</text>
          <rect x="86" y="0" width="12" height="28" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.4" />
          <text x="92" y="17" textAnchor="middle" fill="#0F172A" fontSize="7.5" fontWeight="700">M</text>
        </g>

        {/* Green lawn between E and O */}
        <g transform="translate(604, 704) rotate(-22)">
          <rect x="0" y="0" width="58" height="12" fill="#16A34A" fillOpacity="0.88" />
          <rect x="64" y="-4" width="38" height="20" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.4" />
          <text x="83" y="9" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">F</text>
        </g>

        <g transform="translate(610, 718) rotate(-22)">
          <rect x="0" y="0" width="92" height="22" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.8" />
          <text x="46" y="14" textAnchor="middle" fill="#0F172A" fontSize="8.2" fontWeight="700">
            aulas O 1-10
          </text>
        </g>

        <g transform="translate(618, 748) rotate(-22)">
          <rect x="0" y="0" width="94" height="22" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.8" />
          <text x="47" y="14" textAnchor="middle" fill="#0F172A" fontSize="8.2" fontWeight="700">
            aulas D 1-12
          </text>
        </g>

        <g transform="translate(588, 792) rotate(-22)">
          <rect x="0" y="0" width="60" height="20" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.8" />
          <text x="30" y="13" textAnchor="middle" fill="#0F172A" fontSize="7.8" fontWeight="700">
            aulas S 1-8
          </text>
        </g>
        <g transform="translate(652, 766) rotate(-22)">
          <rect x="0" y="0" width="62" height="20" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.8" />
          <text x="31" y="13" textAnchor="middle" fill="#0F172A" fontSize="7.8" fontWeight="700">
            aulas T 1-14
          </text>
        </g>

        {/* Arquitectura (A) parallel workshops & Plaza Cívica */}
        <g transform="translate(490, 744) rotate(-22)">
          <rect x="0" y="0" width="84" height="50" fill="#FFFFFF" stroke="#0F172A" strokeWidth="1.6" />
          <line x1="18" y1="0" x2="18" y2="38" stroke="#475569" strokeWidth="1.2" />
          <line x1="36" y1="0" x2="36" y2="38" stroke="#475569" strokeWidth="1.2" />
          <line x1="54" y1="0" x2="54" y2="38" stroke="#475569" strokeWidth="1.2" />
          <text x="42" y="45" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">
            Arq. (A)
          </text>
        </g>
        <text x="498" y="846" textAnchor="middle" fill="#334155" fontSize="7.5" fontWeight="600">
          Plaza Cívica
        </text>
        <text x="772" y="698" fill="#475569" fontSize="7" fontWeight="600" transform="rotate(-18 772 698)">
          COLINDANCIA ESC. No. 1
        </text>

        {/* Unidad Sur Callout Pins */}
        <line x1="760" y1="712" x2="694" y2="704" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="772" cy="714" r="21" fill="#5D162F" />
        <text x="772" y="721" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          O
        </text>

        <line x1="752" y1="762" x2="698" y2="736" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="764" cy="766" r="21" fill="#5D162F" />
        <text x="764" y="773" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          D
        </text>

        <line x1="708" y1="812" x2="684" y2="776" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="716" cy="822" r="21" fill="#5D162F" />
        <text x="716" y="829" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          T
        </text>

        <line x1="648" y1="840" x2="620" y2="800" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="654" cy="850" r="21" fill="#5D162F" />
        <text x="654" y="857" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          S
        </text>

        <line x1="556" y1="842" x2="532" y2="796" stroke="#5D162F" strokeWidth="4.5" />
        <circle cx="562" cy="852" r="21" fill="#5D162F" />
        <text x="562" y="859" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          A
        </text>

        {/* Legend (Bottom-Left) */}
        <g fontSize="11.2" fill="#0F172A">
          <text x="26" y="576" fontWeight="700">S, T:</text>
          <text x="64" y="576" fontWeight="600">LIC. EN ADMINISTRACIÓN E</text>
          <text x="64" y="590" fontWeight="600">ING. EN GESTIÓN EMPRESARIAL</text>

          <text x="26" y="620" fontWeight="700">O, D:</text>
          <text x="64" y="620" fontWeight="600">ING. CIVIL</text>

          <text x="26" y="650" fontWeight="700">A:</text>
          <text x="64" y="650" fontWeight="600">ARQUITECTURA</text>

          <text x="26" y="680" fontWeight="700">QB:</text>
          <text x="64" y="680" fontWeight="600">ING. QUÍMICA E ING. BIOQUÍMICA</text>

          <text x="26" y="710" fontWeight="700">SC:</text>
          <text x="64" y="710" fontWeight="600">ING. EN SISTEMAS, ING. INFORMÁTICA</text>
          <text x="64" y="724" fontWeight="600">E ING. EN TECNOLOGÍAS DE INF. Y COM.</text>

          <text x="26" y="754" fontWeight="700">EE:</text>
          <text x="64" y="754" fontWeight="600">ING. ELÉCTRICA E ING. ELECTRÓNICA</text>

          <text x="26" y="784" fontWeight="700">I:</text>
          <text x="64" y="784" fontWeight="600">ING. INDUSTRIAL</text>

          <text x="26" y="814" fontWeight="700">MM:</text>
          <text x="64" y="814" fontWeight="600">ING. MECÁNICA E ING. MECATRÓNICA</text>

          <text x="26" y="844" fontWeight="700">UTD:</text>
          <text x="64" y="844" fontWeight="600">UNIDAD DE EDUCACIÓN A DISTANCIA</text>
        </g>

        {/* Bottom-Right Institutional Label */}
        <text x="874" y="756" textAnchor="middle" fill="#1E3A5F" fontSize="13" fontWeight="700">
          TECNOLÓGICO
        </text>
        <text x="874" y="772" textAnchor="middle" fill="#1E3A5F" fontSize="13" fontWeight="700">
          NACIONAL DE MÉXICO
        </text>
        <text x="874" y="790" textAnchor="middle" fill="#5D162F" fontSize="10" fontWeight="700">
          CAMPUS DURANGO
        </text>

        {/* Bottom Banner */}
        <rect x="0" y="930" width="960" height="50" fill="#5D162F" />
        <text
          x="480"
          y="963"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="24"
          fontWeight="700"
          letterSpacing="5"
        >
          UBICA TU UNIDAD ACADÉMICA
        </text>
      </svg>
    </div>
  );
}
