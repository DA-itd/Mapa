import {useEffect, useState} from 'react';
import {
  Check,
  Copy,
  Crosshair,
  Download,
  FileSpreadsheet,
  Plus,
  RotateCcw,
  Trash2,
  X,
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

export type ContributeModalTab = 'editor' | 'export';

interface ContributeModalProps {
  isOpen: boolean;
  onClose: () => void;
  buildings: CampusBuildingEntry[];
  editingBuildingId: string | null;
  pickedCoords: {lat: number; lng: number} | null;
  onClearPickedCoords: () => void;
  onRequestMapPickForBuilding: (draft: CampusBuildingEntry) => void;
  onSaveBuildings: (updated: CampusBuildingEntry[]) => void;
  onResetToRepo: () => void;
  hasLocalChanges: boolean;
  initialDraft?: CampusBuildingEntry | null;
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

function createEmptyBuilding(): CampusBuildingEntry {
  return {
    id: `itd-nuevo-${Date.now().toString(36)}`,
    code: 'NUEVO',
    name: '',
    category: 'Académico',
    description: '',
    matchKeywords: [],
    customLatLng: null,
    accessibilityNotes: '',
    updatedBy: '',
    updatedAt: new Date().toISOString().slice(0, 10),
    spaces: [],
  };
}

export function ContributeModal({
  isOpen,
  onClose,
  buildings,
  editingBuildingId,
  pickedCoords,
  onClearPickedCoords,
  onRequestMapPickForBuilding,
  onSaveBuildings,
  onResetToRepo,
  hasLocalChanges,
  initialDraft,
}: ContributeModalProps) {
  const [tab, setTab] = useState<ContributeModalTab>('editor');
  const [selectedId, setSelectedId] = useState<string>('__new__');
  const [draft, setDraft] = useState<CampusBuildingEntry>(createEmptyBuilding);
  const [copied, setCopied] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (initialDraft) {
      setSelectedId(
        buildings.some((b) => b.id === initialDraft.id)
          ? initialDraft.id
          : '__new__'
      );
      setDraft({
        ...initialDraft,
        customLatLng: pickedCoords ?? initialDraft.customLatLng ?? null,
      });
      return;
    }

    if (editingBuildingId) {
      const existing = buildings.find((b) => b.id === editingBuildingId);
      if (existing) {
        setSelectedId(existing.id);
        setDraft({
          ...existing,
          spaces: existing.spaces.map((s) => ({...s})),
          customLatLng: pickedCoords ?? existing.customLatLng ?? null,
        });
        return;
      }
    }

    if (buildings.length > 0 && selectedId === '__new__' && !pickedCoords) {
      const first = buildings[0];
      setSelectedId(first.id);
      setDraft({
        ...first,
        spaces: first.spaces.map((s) => ({...s})),
      });
    }
  }, [isOpen, editingBuildingId, buildings, pickedCoords, initialDraft]);

  useEffect(() => {
    if (pickedCoords) {
      setDraft((prev) => ({
        ...prev,
        customLatLng: pickedCoords,
      }));
    }
  }, [pickedCoords]);

  if (!isOpen) return null;

  const handleSelectExisting = (id: string) => {
    setSelectedId(id);
    onClearPickedCoords();
    if (id === '__new__') {
      setDraft(createEmptyBuilding());
      return;
    }
    const found = buildings.find((b) => b.id === id);
    if (found) {
      setDraft({
        ...found,
        spaces: found.spaces.map((s) => ({...s})),
      });
    }
  };

  const handleAddSpace = () => {
    const newSpace: CampusSpace = {
      id: `sp-${Date.now().toString(36)}`,
      code: '',
      name: '',
      kind: 'Aula',
      floor: 'Planta Baja',
      schedule: '',
      notes: '',
    };
    setDraft((prev) => ({
      ...prev,
      spaces: [...prev.spaces, newSpace],
    }));
  };

  const handleUpdateSpace = (
    idx: number,
    patch: Partial<CampusSpace>
  ) => {
    setDraft((prev) => ({
      ...prev,
      spaces: prev.spaces.map((sp, i) => (i === idx ? {...sp, ...patch} : sp)),
    }));
  };

  const handleRemoveSpace = (idx: number) => {
    setDraft((prev) => ({
      ...prev,
      spaces: prev.spaces.filter((_, i) => i !== idx),
    }));
  };

  const handleSave = () => {
    if (!draft.name.trim()) return;
    const cleaned: CampusBuildingEntry = {
      ...draft,
      id:
        selectedId === '__new__'
          ? `itd-${draft.name
              .toLowerCase()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '') || Date.now().toString(36)}`
          : draft.id,
      code: draft.code.trim() || 'ITD',
      name: draft.name.trim(),
      description:
        draft.description.trim() ||
        'Área del campus actualizada por la comunidad estudiantil.',
      updatedAt: new Date().toISOString().slice(0, 10),
      spaces: draft.spaces.filter((s) => s.name.trim().length > 0),
    };

    const exists = buildings.some((b) => b.id === cleaned.id);
    const updatedList = exists
      ? buildings.map((b) => (b.id === cleaned.id ? cleaned : b))
      : [...buildings, cleaned];

    onSaveBuildings(updatedList);
    setSelectedId(cleaned.id);
    setDraft(cleaned);
    onClearPickedCoords();
    setSavedNotice(
      'Guardado localmente. Ya puedes verlo en el mapa o exportarlo en formato JSON/CSV.'
    );
    setTimeout(() => setSavedNotice(null), 4000);
  };

  const exportJson = buildDirectoryExportJson(buildings);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([exportJson], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campus-directory.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const csv = buildDirectoryCsvExport(buildings);
    const blob = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `directorio-itd-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              Contribuciones del Campus ITD
            </h2>
            <p className="text-xs text-slate-500">
              Actualiza edificios, oficinas, aulas y laboratorios del directorio
              del campus.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Sub-navigation tabs */}
        <div className="flex gap-2 border-b border-slate-200 bg-slate-50 px-6 py-2.5">
          <button
            type="button"
            onClick={() => setTab('editor')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === 'editor'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            1. Editar Edificio y Áreas
          </button>
          <button
            type="button"
            onClick={() => setTab('export')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              tab === 'export'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            2. Exportar Base de Datos
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === 'editor' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="min-w-[240px] flex-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Seleccionar edificio a editar o crear uno nuevo
                  </label>
                  <select
                    value={selectedId}
                    onChange={(e) => handleSelectExisting(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
                  >
                    <option value="__new__">+ Crear nuevo edificio o área</option>
                    {buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.code} — {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                {hasLocalChanges && (
                  <button
                    type="button"
                    onClick={onResetToRepo}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Restablecer catálogo base
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Clave
                  </label>
                  <input
                    type="text"
                    value={draft.code}
                    onChange={(e) =>
                      setDraft((p) => ({...p, code: e.target.value}))
                    }
                    placeholder="Ej. CC, A, ING"
                    className="font-mono-tabular mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#6F1D3A] focus:outline-none"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-xs font-semibold text-slate-700">
                    Nombre del edificio o área
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((p) => ({...p, name: e.target.value}))
                    }
                    placeholder="Ej. Edificio de Sistemas y Computación"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#6F1D3A] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">
                    Categoría
                  </label>
                  <select
                    value={draft.category}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        category: e.target.value as BuildingCategory,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-[#6F1D3A] focus:outline-none"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">
                  Descripción breve
                </label>
                <textarea
                  rows={2}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((p) => ({...p, description: e.target.value}))
                  }
                  placeholder="Describe qué departamentos, laboratorios o servicios aloja este edificio..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-[#6F1D3A] focus:outline-none"
                />
              </div>

              {/* Coordinates Picker */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <div>
                  <div className="text-xs font-semibold text-slate-800">
                    Ubicación exacta en Google Maps
                  </div>
                  <div className="font-mono-tabular mt-0.5 text-xs text-slate-600">
                    {draft.customLatLng
                      ? `Pin fijado: ${draft.customLatLng.lat.toFixed(6)}, ${draft.customLatLng.lng.toFixed(6)}`
                      : 'Automático por coincidencia con Google Maps (o fija un pin exacto)'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {draft.customLatLng && (
                    <button
                      type="button"
                      onClick={() => {
                        onClearPickedCoords();
                        setDraft((p) => ({...p, customLatLng: null}));
                      }}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Quitar pin
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRequestMapPickForBuilding(draft)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    Fijar pin en el mapa
                  </button>
                </div>
              </div>

              {/* Spaces (Oficinas, Aulas, Labs) */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Oficinas, Aulas y Laboratorios interiores
                    </h3>
                    <p className="text-xs text-slate-500">
                      Agrega salones, laboratorios, jefaturas o módulos de
                      atención dentro de este edificio.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddSpace}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agregar área
                  </button>
                </div>

                <div className="mt-3 space-y-2.5">
                  {draft.spaces.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 py-4 text-center text-xs text-slate-500">
                      No hay áreas interiores agregadas todavía. Haz clic en
                      "Agregar área".
                    </p>
                  ) : (
                    draft.spaces.map((sp, idx) => (
                      <div
                        key={sp.id}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-12"
                      >
                        <input
                          type="text"
                          value={sp.code}
                          onChange={(e) =>
                            handleUpdateSpace(idx, {code: e.target.value})
                          }
                          placeholder="Código (A-101)"
                          className="font-mono-tabular rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-2"
                        />
                        <input
                          type="text"
                          value={sp.name}
                          onChange={(e) =>
                            handleUpdateSpace(idx, {name: e.target.value})
                          }
                          placeholder="Nombre del aula, lab u oficina"
                          className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-4"
                        />
                        <select
                          value={sp.kind}
                          onChange={(e) =>
                            handleUpdateSpace(idx, {
                              kind: e.target.value as SpaceKind,
                            })
                          }
                          className="rounded border border-slate-200 bg-white px-2 py-1.5 text-xs sm:col-span-2"
                        >
                          {SPACE_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={sp.floor}
                          onChange={(e) =>
                            handleUpdateSpace(idx, {floor: e.target.value})
                          }
                          placeholder="Piso (Planta Baja)"
                          className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs sm:col-span-2"
                        />
                        <div className="flex items-center gap-1 sm:col-span-2">
                          <input
                            type="text"
                            value={sp.schedule ?? ''}
                            onChange={(e) =>
                              handleUpdateSpace(idx, {schedule: e.target.value})
                            }
                            placeholder="Horario"
                            className="min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveSpace(idx)}
                            title="Eliminar área"
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {savedNotice && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                  {savedNotice}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setTab('export')}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Ir a exportar datos
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!draft.name.trim()}
                  className="rounded-lg bg-[#6F1D3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#58162d] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  Guardar cambios en el mapa
                </button>
              </div>
            </div>
          )}

          {tab === 'export' && (
            <div className="space-y-4">
              <p className="text-xs leading-relaxed text-slate-600">
                Descarga el directorio completo con coordenadas GPS, edificios,
                aulas, laboratorios y oficinas para respaldarlo o abrirlo en
                Excel.
              </p>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Descargar CSV (Excel)
                </button>

                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#6F1D3A] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#58162d] whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Descargar JSON
                </button>

                <button
                  type="button"
                  onClick={handleCopyJson}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? 'JSON copiado' : 'Copiar JSON'}
                </button>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-500">
                  <span className="font-mono">campus-directory.json</span>
                  <span className="tabular-nums">
                    {buildings.length} edificios
                  </span>
                </div>
                <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs leading-relaxed text-slate-100">
                  {exportJson}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
