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
        viewBox="0 0 900 920"
        className="block h-auto w-full select-none"
        role="img"
        aria-label="Plano de unidades académicas del Instituto Tecnológico de Durango"
      >
        <rect x="0" y="0" width="900" height="52" fill="#5D162F" />
        <text
          x="450"
          y="34"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="24"
          fontWeight="700"
          letterSpacing="4"
        >
          INSTITUTO TECNOLÓGICO DE DURANGO
        </text>

        <rect x="0" y="52" width="900" height="816" fill="#FFFFFF" />

        <text
          x="335"
          y="108"
          textAnchor="middle"
          fill="#1E293B"
          fontSize="11"
          fontWeight="700"
        >
          AV. JESÚS GARCÍA
        </text>

        <path
          d="M 110 120 L 820 120 L 820 400 L 185 400 L 160 310 L 110 140 Z"
          fill="#F8FAFC"
          stroke="#1E293B"
          strokeWidth="2.5"
        />

        <text
          x="130"
          y="225"
          fill="#1E293B"
          fontSize="10"
          fontWeight="700"
          transform="rotate(71 130 225)"
        >
          BLVD. TECNOLÓGICO
        </text>

        <path
          d="M 330 125 A 160 125 0 0 0 490 250 L 330 250 Z"
          fill="#FFFFFF"
          stroke="#94A3B8"
          strokeWidth="1.5"
        />
        <text x="395" y="192" fill="#334155" fontSize="10" fontWeight="600">
          Campo de Beisbol
        </text>

        <rect
          x="185"
          y="310"
          width="115"
          height="82"
          rx="4"
          fill="#FEF2F2"
          stroke="#EA580C"
          strokeWidth="1.2"
        />
        <text
          x="242"
          y="355"
          textAnchor="middle"
          fill="#9A3412"
          fontSize="10"
          fontWeight="600"
        >
          Estacionamiento
        </text>

        <rect
          x="320"
          y="305"
          width="55"
          height="65"
          fill="#FFFFFF"
          stroke="#475569"
          strokeWidth="1.5"
        />
        <text x="347" y="342" textAnchor="middle" fill="#475569" fontSize="11">
          h
        </text>

        <path
          d="M 645 220 L 735 220 L 770 395 L 605 395 Z"
          fill="#22C55E"
          fillOpacity="0.28"
          stroke="#16A34A"
          strokeWidth="1"
        />

        <rect
          x="505"
          y="150"
          width="68"
          height="32"
          fill="#FFFFFF"
          stroke="#1E293B"
          strokeWidth="1.8"
        />
        <text
          x="539"
          y="164"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="7.5"
          fontWeight="700"
        >
          SISTEMAS Y
        </text>
        <text
          x="539"
          y="173"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="7.5"
          fontWeight="700"
        >
          COMPUTACIÓN
        </text>
        <text
          x="539"
          y="180"
          textAnchor="middle"
          fill="#475569"
          fontSize="7"
          fontWeight="600"
        >
          aulas SC
        </text>

        <rect
          x="485"
          y="198"
          width="68"
          height="34"
          fill="#FFFFFF"
          stroke="#1E293B"
          strokeWidth="1.8"
        />
        <text
          x="519"
          y="211"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="7.5"
          fontWeight="700"
        >
          QUÍMICA Y
        </text>
        <text
          x="519"
          y="220"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="7.5"
          fontWeight="700"
        >
          BIOQUÍMICA
        </text>
        <text
          x="519"
          y="229"
          textAnchor="middle"
          fill="#475569"
          fontSize="7"
          fontWeight="600"
        >
          aulas QB
        </text>

        <rect
          x="592"
          y="135"
          width="62"
          height="42"
          fill="#FFFFFF"
          stroke="#1E293B"
          strokeWidth="1.8"
        />
        <text
          x="623"
          y="150"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="8"
          fontWeight="700"
        >
          ELÉCTRICA Y
        </text>
        <text
          x="623"
          y="160"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="8"
          fontWeight="700"
        >
          ELECTRÓNICA
        </text>
        <text
          x="623"
          y="171"
          textAnchor="middle"
          fill="#475569"
          fontSize="7.5"
          fontWeight="700"
        >
          aulas EE 1-14
        </text>

        <rect
          x="595"
          y="180"
          width="56"
          height="32"
          fill="#64748B"
          stroke="#334155"
          strokeWidth="1.2"
        />
        <text
          x="623"
          y="200"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="9"
          fontWeight="700"
        >
          Domo
        </text>

        <rect
          x="592"
          y="214"
          width="62"
          height="30"
          fill="#FFFFFF"
          stroke="#1E293B"
          strokeWidth="1.8"
        />
        <text
          x="623"
          y="227"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="8"
          fontWeight="700"
        >
          DISTANCIA
        </text>
        <text
          x="623"
          y="238"
          textAnchor="middle"
          fill="#475569"
          fontSize="7.5"
          fontWeight="700"
        >
          aulas UTD 1-9
        </text>

        <rect
          x="592"
          y="272"
          width="62"
          height="32"
          fill="#FFFFFF"
          stroke="#1E293B"
          strokeWidth="1.8"
        />
        <text
          x="623"
          y="286"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="8"
          fontWeight="700"
        >
          INDUSTRIAL
        </text>
        <text
          x="623"
          y="297"
          textAnchor="middle"
          fill="#475569"
          fontSize="7.5"
          fontWeight="700"
        >
          aulas I 1-12
        </text>

        <rect
          x="554"
          y="324"
          width="66"
          height="34"
          fill="#FFFFFF"
          stroke="#1E293B"
          strokeWidth="1.8"
        />
        <text
          x="587"
          y="336"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="7.5"
          fontWeight="700"
        >
          MECÁNICA Y
        </text>
        <text
          x="587"
          y="345"
          textAnchor="middle"
          fill="#0F172A"
          fontSize="7.5"
          fontWeight="700"
        >
          MECATRÓNICA
        </text>
        <text
          x="587"
          y="354"
          textAnchor="middle"
          fill="#475569"
          fontSize="7"
          fontWeight="700"
        >
          aulas MM
        </text>

        <text
          x="834"
          y="265"
          textAnchor="middle"
          fill="#475569"
          fontSize="8.5"
          fontWeight="600"
          transform="rotate(-90 834 265)"
        >
          COMISIÓN FEDERAL DE ELECTRICIDAD
        </text>

        <line x1="478" y1="125" x2="515" y2="156" stroke="#5D162F" strokeWidth="4" />
        <circle cx="472" cy="116" r="22" fill="#5D162F" />
        <text x="472" y="123" textAnchor="middle" fill="#FFFFFF" fontSize="16" fontWeight="700">
          SC
        </text>

        <line x1="468" y1="192" x2="495" y2="208" stroke="#5D162F" strokeWidth="4" />
        <circle cx="460" cy="188" r="21" fill="#5D162F" />
        <text x="460" y="195" textAnchor="middle" fill="#FFFFFF" fontSize="16" fontWeight="700">
          QB
        </text>

        <line x1="572" y1="108" x2="604" y2="144" stroke="#5D162F" strokeWidth="4" />
        <circle cx="566" cy="100" r="22" fill="#5D162F" />
        <text x="566" y="107" textAnchor="middle" fill="#FFFFFF" fontSize="16" fontWeight="700">
          EE
        </text>

        <line x1="692" y1="122" x2="646" y2="224" stroke="#5D162F" strokeWidth="4" />
        <circle cx="702" cy="106" r="23" fill="#5D162F" />
        <text x="702" y="112" textAnchor="middle" fill="#FFFFFF" fontSize="14" fontWeight="700">
          UTD
        </text>

        <line x1="848" y1="288" x2="648" y2="288" stroke="#5D162F" strokeWidth="4" />
        <circle cx="862" cy="288" r="22" fill="#5D162F" />
        <text x="862" y="295" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontWeight="700">
          I
        </text>

        <line x1="848" y1="382" x2="618" y2="342" stroke="#5D162F" strokeWidth="4" />
        <circle cx="864" cy="385" r="22" fill="#5D162F" />
        <text x="864" y="391" textAnchor="middle" fill="#FFFFFF" fontSize="15" fontWeight="700">
          MM
        </text>

        <g transform="translate(88, 365)">
          <text x="0" y="-62" textAnchor="middle" fill="#475569" fontSize="9.5" fontWeight="600">
            LIVERPOOL
          </text>
          <circle cx="0" cy="0" r="34" fill="none" stroke="#1E293B" strokeWidth="1.5" />
          <line x1="0" y1="-48" x2="0" y2="92" stroke="#1E293B" strokeWidth="1.5" />
          <line x1="-44" y1="0" x2="44" y2="0" stroke="#1E293B" strokeWidth="1.5" />
          <path d="M -34 0 L 0 -36 L 34 0" fill="none" stroke="#1E293B" strokeWidth="1.5" />
          <text x="10" y="56" fill="#1E293B" fontSize="22" fontWeight="500">
            norte
          </text>
        </g>

        <line x1="190" y1="406" x2="760" y2="412" stroke="#0F172A" strokeWidth="2.5" />
        <line x1="210" y1="422" x2="755" y2="428" stroke="#0F172A" strokeWidth="2.5" />
        <text x="518" y="418" textAnchor="middle" fill="#0F172A" fontSize="10" fontWeight="700">
          BLVD. FELIPE PESCADOR
        </text>

        <path
          d="M 215 432 L 758 432 L 758 552 L 668 575 L 705 702 L 420 822 L 215 432 Z"
          fill="#F8FAFC"
          stroke="#1E293B"
          strokeWidth="2.5"
        />

        <path d="M 326 440 L 368 440 L 468 785 L 425 804 Z" fill="#16A34A" fillOpacity="0.28" />

        <g transform="translate(475, 588) rotate(-21)">
          <rect x="-62" y="-102" width="124" height="204" rx="62" fill="#991B1B" stroke="#475569" strokeWidth="2" />
          <rect x="-42" y="-78" width="84" height="156" rx="14" fill="#16A34A" />
          <text x="0" y="4" textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="700">
            ESTADIO
          </text>
        </g>

        <g transform="translate(275, 514) rotate(-22)">
          <rect x="0" y="0" width="44" height="16" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.5" />
          <text x="22" y="11" textAnchor="middle" fill="#0F172A" fontSize="7" fontWeight="700">
            aulas U 1-4
          </text>
        </g>
        <g transform="translate(288, 538) rotate(-22)">
          <rect x="0" y="0" width="44" height="15" fill="#FFFFFF" stroke="#1E293B" strokeWidth="1.3" />
          <text x="22" y="10" textAnchor="middle" fill="#0F172A" fontSize="7" fontWeight="700">
            aulas H 1-3
          </text>
        </g>

        <rect x="592" y="468" width="54" height="58" fill="#FFFFFF" stroke="#64748B" strokeWidth="1.2" />
        <text x="619" y="500" textAnchor="middle" fill="#475569" fontSize="8.5" fontWeight="600">
          CANCHAS
        </text>
        <rect x="674" y="456" width="74" height="90" rx="4" fill="#FEF2F2" stroke="#EA580C" strokeWidth="1.2" />

        <g transform="translate(558, 636) rotate(-22)">
          <rect x="0" y="0" width="92" height="24" fill="#FFFFFF" stroke="#1E293B" strokeWidth="1.5" />
          <text x="46" y="15" textAnchor="middle" fill="#334155" fontSize="9" fontWeight="700">
            E
          </text>
        </g>

        <g transform="translate(572, 672) rotate(-22)">
          <rect x="0" y="0" width="86" height="22" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.8" />
          <text x="43" y="14" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">
            aulas O 1-10
          </text>
        </g>

        <g transform="translate(580, 702) rotate(-22)">
          <rect x="0" y="0" width="88" height="22" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.8" />
          <text x="44" y="14" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">
            aulas D 1-12
          </text>
        </g>

        <g transform="translate(550, 744) rotate(-22)">
          <rect x="0" y="0" width="58" height="20" fill="#FFFFFF" stroke="#1E293B" strokeWidth="1.8" />
          <text x="29" y="13" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="700">
            aulas S 1-8
          </text>
        </g>
        <g transform="translate(614, 720) rotate(-22)">
          <rect x="0" y="0" width="58" height="20" fill="#FFFFFF" stroke="#1E293B" strokeWidth="1.8" />
          <text x="29" y="13" textAnchor="middle" fill="#0F172A" fontSize="8" fontWeight="700">
            aulas T 1-14
          </text>
        </g>

        <g transform="translate(466, 705) rotate(-22)">
          <rect x="0" y="0" width="76" height="46" fill="#FFFFFF" stroke="#1E293B" strokeWidth="1.5" />
          <text x="38" y="26" textAnchor="middle" fill="#0F172A" fontSize="8.5" fontWeight="700">
            Arq. (A)
          </text>
        </g>
        <text x="484" y="788" textAnchor="middle" fill="#475569" fontSize="7.5" fontWeight="600">
          Plaza Cívica
        </text>

        <line x1="712" y1="664" x2="652" y2="658" stroke="#5D162F" strokeWidth="4" />
        <circle cx="722" cy="666" r="21" fill="#5D162F" />
        <text x="722" y="673" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          O
        </text>

        <line x1="704" y1="712" x2="656" y2="688" stroke="#5D162F" strokeWidth="4" />
        <circle cx="714" cy="716" r="21" fill="#5D162F" />
        <text x="714" y="723" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          D
        </text>

        <line x1="664" y1="758" x2="646" y2="728" stroke="#5D162F" strokeWidth="4" />
        <circle cx="670" cy="768" r="21" fill="#5D162F" />
        <text x="670" y="775" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          T
        </text>

        <line x1="606" y1="786" x2="584" y2="752" stroke="#5D162F" strokeWidth="4" />
        <circle cx="612" cy="795" r="21" fill="#5D162F" />
        <text x="612" y="802" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          S
        </text>

        <line x1="518" y1="784" x2="495" y2="748" stroke="#5D162F" strokeWidth="4" />
        <circle cx="524" cy="794" r="21" fill="#5D162F" />
        <text x="524" y="801" textAnchor="middle" fill="#FFFFFF" fontSize="17" fontWeight="700">
          A
        </text>

        <g fontSize="11.5" fill="#0F172A">
          <text x="32" y="542" fontWeight="700">S, T:</text>
          <text x="68" y="542" fontWeight="600">LIC. EN ADMINISTRACIÓN E</text>
          <text x="68" y="556" fontWeight="600">ING. EN GESTIÓN EMPRESARIAL</text>

          <text x="32" y="586" fontWeight="700">O, D:</text>
          <text x="68" y="586" fontWeight="600">ING. CIVIL</text>

          <text x="32" y="616" fontWeight="700">A:</text>
          <text x="68" y="616" fontWeight="600">ARQUITECTURA</text>

          <text x="32" y="646" fontWeight="700">QB:</text>
          <text x="68" y="646" fontWeight="600">ING. QUÍMICA E ING. BIOQUÍMICA</text>

          <text x="32" y="676" fontWeight="700">SC:</text>
          <text x="68" y="676" fontWeight="600">ING. EN SISTEMAS, ING. INFORMÁTICA</text>
          <text x="68" y="690" fontWeight="600">E ING. EN TECNOLOGÍAS DE INF. Y COM.</text>

          <text x="32" y="720" fontWeight="700">EE:</text>
          <text x="68" y="720" fontWeight="600">ING. ELÉCTRICA E ING. ELECTRÓNICA</text>

          <text x="32" y="750" fontWeight="700">I:</text>
          <text x="68" y="750" fontWeight="600">ING. INDUSTRIAL</text>

          <text x="32" y="780" fontWeight="700">MM:</text>
          <text x="68" y="780" fontWeight="600">ING. MECÁNICA E ING. MECATRÓNICA</text>

          <text x="32" y="810" fontWeight="700">UTD:</text>
          <text x="68" y="810" fontWeight="600">UNIDAD DE EDUCACIÓN A DISTANCIA</text>
        </g>

        <text x="822" y="710" textAnchor="middle" fill="#1E3A5F" fontSize="13" fontWeight="700">
          TECNOLÓGICO
        </text>
        <text x="822" y="726" textAnchor="middle" fill="#1E3A5F" fontSize="13" fontWeight="700">
          NACIONAL DE MÉXICO
        </text>
        <text x="822" y="744" textAnchor="middle" fill="#5D162F" fontSize="10" fontWeight="700">
          CAMPUS DURANGO
        </text>

        <rect x="0" y="868" width="900" height="52" fill="#5D162F" />
        <text
          x="450"
          y="902"
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
