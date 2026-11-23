import {useMemo, useState} from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Crosshair,
  Download,
  FileSpreadsheet,
  LocateFixed,
  Map as MapIcon,
  Plus,
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

interface FieldSurveyPanelProps {
  buildings: CampusBuildingEntry[];
  onSaveBuildings: (updated: CampusBuildingEntry[]) => void;
  hasMapsKey: boolean;
  onRequestMapPick?: () => void;
  pickedCoords?: {lat: number; lng: number} | null;
  onClearPickedCoords?: () => void;
  onFocusCoords?: (coords: {lat: number; lng: number}, zoom?: number) => void;
}

const CATEGORIES: BuildingCategory[] = [
  'Académico',
  'Laboratorios',
  'Administrativo',
  'Biblioteca e Información',
  'Deporte y Cultura',
  'Servicios Estudiantiles',
];

const SPACE_KINDS: SpaceKind[] = [
  'Aula',
  'Laboratorio',
  'Oficina',
  'Servicio',
  'Auditorio',
];

const SURVEYOR_STORAGE_KEY = 'itd_surveyor_name_v1';

export function FieldSurveyPanel({
  buildings,
  onSaveBuildings,
  hasMapsKey,
  onRequestMapPick,
  pickedCoords,
  onClearPickedCoords,
  onFocusCoords,
}: FieldSurveyPanelProps) {
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

  const [spaceCode, setSpaceCode] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [spaceKind, setSpaceKind] = useState<SpaceKind>('Aula');
  const [spaceFloor, setSpaceFloor] = useState('Planta Baja');
  const [spaceSchedule, setSpaceSchedule] = useState('');
  const [spaceNotes, setSpaceNotes] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showReferenceMap, setShowReferenceMap] = useState<boolean>(true);

  const activeCoords = pickedCoords ?? gpsCoords;

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

  const handleCaptureGps = () => {
    if (!navigator.geolocation) {
      setGpsError('Este navegador no soporta geolocalización.');
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
            ? 'Permiso de ubicación denegado. Activa el GPS en tu navegador para capturar coordenadas en campo.'
            : 'No se pudo obtener lectura GPS. Intenta acercarte a un espacio abierto.'
        );
      },
      {enableHighAccuracy: true, maximumAge: 0, timeout: 15000}
    );
  };

  const handleSaveSurveyEntry = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);

    if (surveyorName.trim()) {
      localStorage.setItem(SURVEYOR_STORAGE_KEY, surveyorName.trim());
    }

    const today = new Date().toISOString().slice(0, 10);
    const hasNewSpace = spaceName.trim().length > 0;

    const newSpace: CampusSpace | null = hasNewSpace
      ? {
          id: `sp-${Date.now().toString(36)}`,
          code: spaceCode.trim() || 'S/N',
          name: spaceName.trim(),
          kind: spaceKind,
          floor: spaceFloor.trim() || 'Planta Baja',
          schedule: spaceSchedule.trim() || undefined,
          notes: spaceNotes.trim() || undefined,
        }
      : null;

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
    } else {
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
    }

    setSpaceCode('');
    setSpaceName('');
    setSpaceSchedule('');
    setSpaceNotes('');
    setSaveMessage(
      'Registro guardado en la base de datos local. Puedes seguir capturando el siguiente salón.'
    );
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
    <div className="flex h-full flex-col overflow-y-auto bg-slate-50 p-4 md:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        {/* Header & Survey Metrics */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Brigada de Levantamiento GPS — Servicio Social ITD
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Recorre cada edificio, aula, laboratorio u oficina, captura la
                coordenada GPS en sitio y genera la base de datos oficial del
                campus (exportable a Excel/CSV y JSON).
              </p>
            </div>
            <div className="flex gap-4 text-right font-mono-tabular">
              <div>
                <div className="text-lg font-bold text-slate-900">
                  {stats.totalBuildings}
                </div>
                <div className="text-[11px] text-slate-500">Edificios</div>
              </div>
              <div>
                <div className="text-lg font-bold text-[#6F1D3A]">
                  {stats.totalSpaces}
                </div>
                <div className="text-[11px] text-slate-500">Aulas / Áreas</div>
              </div>
              <div>
                <div className="text-lg font-bold text-emerald-700">
                  {stats.pinnedBuildings}
                </div>
                <div className="text-[11px] text-slate-500">Con GPS</div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={handleDownloadCsv}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Descargar Base de Datos CSV (Excel)
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <Download className="h-3.5 w-3.5" />
              Descargar campus-directory.json
            </button>
            <button
              type="button"
              onClick={() => setShowReferenceMap((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              <MapIcon className="h-3.5 w-3.5 text-[#6F1D3A]" />
              {showReferenceMap
                ? 'Ocultar plano oficial'
                : 'Ver plano oficial ITD'}
            </button>
          </div>
        </div>

        {/* Official ITD Units Reference Map */}
        {showReferenceMap && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Plano de referencia — Unidades Académicas ITD
                </h3>
                <p className="text-xs text-slate-500">
                  Úsalo en campo para identificar las claves oficiales (SC, QB,
                  EE, UTD, I, MM, S, T, O, D, A, U, H) antes de capturar su GPS.
                </p>
              </div>
            </div>
            <div className="bg-slate-100 p-3">
              <img
                src="/assets/aistudio/image_0f38b691.png"
                alt="Plano oficial de unidades académicas del Instituto Tecnológico de Durango"
                referrerPolicy="no-referrer"
                className="mx-auto max-h-[520px] w-auto rounded-lg border border-slate-200 object-contain"
              />
            </div>
          </div>
        )}

        {/* Field Capture Form */}
        <form
          onSubmit={handleSaveSurveyEntry}
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ClipboardList className="h-4 w-4 text-[#6F1D3A]" />
            <h3 className="text-sm font-bold text-slate-900">
              1. Captura rápida en sitio
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-semibold text-slate-700">
                Nombre del alumno / brigadista
              </label>
              <input
                type="text"
                value={surveyorName}
                onChange={(e) => setSurveyorName(e.target.value)}
                placeholder="Ej. Ana López (Servicio Social)"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700">
                Edificio donde te encuentras
              </label>
              <select
                value={targetBuildingId}
                onChange={(e) => setTargetBuildingId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
              >
                <option value="__new__">+ Registrar nuevo edificio</option>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {targetBuildingId === '__new__' && (
            <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4">
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Clave edificio
                </label>
                <input
                  type="text"
                  required
                  value={newBuildingCode}
                  onChange={(e) => setNewBuildingCode(e.target.value)}
                  placeholder="Ej. EDIF-H"
                  className="font-mono-tabular mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
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
                  placeholder="Ej. Edificio H de Aulas"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Categoría
                </label>
                <select
                  value={newBuildingCategory}
                  onChange={(e) =>
                    setNewBuildingCategory(e.target.value as BuildingCategory)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
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

          {/* GPS Capture Box */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  Coordenadas GPS del edificio / acceso
                </div>
                {activeCoords ? (
                  <div className="font-mono-tabular mt-1 text-xs font-semibold text-emerald-800">
                    Lat: {activeCoords.lat.toFixed(6)} · Lng:{' '}
                    {activeCoords.lng.toFixed(6)}
                    {'accuracy' in activeCoords && activeCoords.accuracy
                      ? ` (±${activeCoords.accuracy} m)`
                      : ''}
                  </div>
                ) : (
                  <p className="mt-0.5 text-xs text-slate-500">
                    Párate frente al edificio y presiona capturar para guardar su
                    latitud y longitud exacta.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCaptureGps}
                  disabled={gpsLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <LocateFixed className="h-3.5 w-3.5" />
                  {gpsLoading ? 'Leyendo GPS...' : 'Capturar GPS actual'}
                </button>
                {hasMapsKey && onRequestMapPick && (
                  <button
                    type="button"
                    onClick={onRequestMapPick}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    Marcar en mapa
                  </button>
                )}
              </div>
            </div>
            {gpsError && (
              <p className="mt-2 text-xs text-amber-800">{gpsError}</p>
            )}
          </div>

          {/* Room / Aula / Lab / Office Entry */}
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-semibold text-slate-800">
              2. Salón, aula, laboratorio u oficina dentro del edificio
              (opcional si solo quieres fijar el edificio)
            </div>
            <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-6">
              <div className="sm:col-span-1">
                <label className="text-[11px] font-medium text-slate-600">
                  Número / Clave
                </label>
                <input
                  type="text"
                  value={spaceCode}
                  onChange={(e) => setSpaceCode(e.target.value)}
                  placeholder="Ej. A-204"
                  className="font-mono-tabular mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="text-[11px] font-medium text-slate-600">
                  Nombre del salón, laboratorio u oficina
                </label>
                <input
                  type="text"
                  value={spaceName}
                  onChange={(e) => setSpaceName(e.target.value)}
                  placeholder="Ej. Aula 204 / Lab. Electrónica Digital"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div className="sm:col-span-1">
                <label className="text-[11px] font-medium text-slate-600">
                  Tipo
                </label>
                <select
                  value={spaceKind}
                  onChange={(e) => setSpaceKind(e.target.value as SpaceKind)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm"
                >
                  {SPACE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-1">
                <label className="text-[11px] font-medium text-slate-600">
                  Piso
                </label>
                <input
                  type="text"
                  value={spaceFloor}
                  onChange={(e) => setSpaceFloor(e.target.value)}
                  placeholder="Piso 1"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="text"
                value={spaceSchedule}
                onChange={(e) => setSpaceSchedule(e.target.value)}
                placeholder="Horario (ej. L-V 08:00 - 15:00)"
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={spaceNotes}
                onChange={(e) => setSpaceNotes(e.target.value)}
                placeholder="Referencia (ej. Junto a escalera norte, rampa)"
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
            </div>
          </div>

          {saveMessage && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
              <span>{saveMessage}</span>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#6F1D3A] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#58162d]"
            >
              <Plus className="h-4 w-4" />
              Guardar en base de datos
            </button>
          </div>
        </form>

        {/* Live Table of Captured Buildings & Spaces */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-bold text-slate-900">
            Resumen actual del inventario del campus
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Clave</th>
                  <th className="py-2 pr-3 font-semibold">Edificio</th>
                  <th className="py-2 pr-3 font-semibold">Coordenadas GPS</th>
                  <th className="py-2 text-right font-semibold">
                    Aulas / Áreas
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {buildings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="font-mono-tabular py-2 pr-3 font-semibold text-[#6F1D3A]">
                      {b.code}
                    </td>
                    <td className="py-2 pr-3 font-medium text-slate-900">
                      {b.name}
                    </td>
                    <td className="font-mono-tabular py-2 pr-3 text-slate-600">
                      {b.customLatLng
                        ? `${b.customLatLng.lat.toFixed(5)}, ${b.customLatLng.lng.toFixed(5)}`
                        : 'Sin pin GPS'}
                    </td>
                    <td className="font-mono-tabular py-2 text-right text-slate-700">
                      {b.spaces.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
