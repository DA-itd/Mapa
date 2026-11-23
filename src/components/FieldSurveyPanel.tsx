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
import planoItdUrl from '../assets/plano-itd.png?inline';

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
            {planoLoadError ? (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-300">
                No se pudo cargar la imagen del plano. Verifica tu conexión e
                intenta nuevamente.
              </div>
            ) : (
              <div
                className={
                  planoZoomed
                    ? 'min-w-[820px] pb-6'
                    : 'flex h-full items-center justify-center'
                }
              >
                <img
                  src={planoItdUrl}
                  alt="Plano oficial de unidades académicas del Instituto Tecnológico de Durango"
                  onError={() => setPlanoLoadError(true)}
                  className={
                    planoZoomed
                      ? 'mx-auto w-full rounded-lg bg-white object-contain'
                      : 'mx-auto max-h-full w-full max-w-3xl rounded-lg bg-white object-contain'
                  }
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
