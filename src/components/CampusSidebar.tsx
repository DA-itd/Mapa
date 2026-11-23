import {useMemo, useState} from 'react';
import Markdown from 'react-markdown';
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bike,
  Building2,
  Car,
  CheckCircle2,
  CornerUpLeft,
  CornerUpRight,
  Crosshair,
  ExternalLink,
  Footprints,
  LocateFixed,
  MapPin,
  Navigation,
  Pencil,
  Search,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  BuildingCategory,
  ComputedRouteResult,
  GroundingChunkItem,
  ResolvedCampusLocation,
  SpaceKind,
  TravelModeOption,
} from '../types/campus';

export type SidebarTab = 'explore' | 'routes' | 'assistant';

export interface RouteEndpoint {
  label: string;
  coords: {lat: number; lng: number};
}

interface CampusSidebarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  locations: ResolvedCampusLocation[];
  selectedLocation: ResolvedCampusLocation | null;
  onSelectLocation: (loc: ResolvedCampusLocation | null) => void;
  onFocusCoords: (coords: {lat: number; lng: number}, zoom?: number) => void;
  onEditBuilding: (loc: ResolvedCampusLocation) => void;
  onRequestPinBuilding: (loc: ResolvedCampusLocation) => void;
  // Routing props
  originEndpoint: RouteEndpoint | null;
  destinationEndpoint: RouteEndpoint | null;
  onSetOriginEndpoint: (ep: RouteEndpoint | null) => void;
  onSetDestinationEndpoint: (ep: RouteEndpoint | null) => void;
  onSwapEndpoints: () => void;
  onPickMapPoint: (target: 'origin' | 'destination') => void;
  travelMode: TravelModeOption;
  onChangeTravelMode: (mode: TravelModeOption) => void;
  computedRoute: ComputedRouteResult | null;
  routeLoading: boolean;
  routeError: string | null;
  guidedActive: boolean;
  onToggleGuided: (active: boolean) => void;
  activeStepIndex: number;
  onSelectStep: (idx: number) => void;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  // Grounding props
  campusCenter: {lat: number; lng: number} | null;
}

const CATEGORIES: Array<'Todos' | BuildingCategory> = [
  'Todos',
  'Académico',
  'Laboratorios',
  'Administrativo',
  'Biblioteca e Información',
  'Deporte y Cultura',
  'Servicios Estudiantiles',
];

function renderManeuverIcon(maneuver: string) {
  const m = maneuver.toUpperCase();
  if (m.includes('LEFT')) {
    return <CornerUpLeft className="h-5 w-5 text-[#6F1D3A]" />;
  }
  if (m.includes('RIGHT')) {
    return <CornerUpRight className="h-5 w-5 text-[#6F1D3A]" />;
  }
  if (m.includes('DESTINATION') || m.includes('ARRIVE')) {
    return <CheckCircle2 className="h-5 w-5 text-emerald-700" />;
  }
  return <ArrowUp className="h-5 w-5 text-[#6F1D3A]" />;
}

export function CampusSidebar({
  activeTab,
  onTabChange,
  locations,
  selectedLocation,
  onSelectLocation,
  onFocusCoords,
  onEditBuilding,
  onRequestPinBuilding,
  originEndpoint,
  destinationEndpoint,
  onSetOriginEndpoint,
  onSetDestinationEndpoint,
  onSwapEndpoints,
  onPickMapPoint,
  travelMode,
  onChangeTravelMode,
  computedRoute,
  routeLoading,
  routeError,
  guidedActive,
  onToggleGuided,
  activeStepIndex,
  onSelectStep,
  voiceEnabled,
  onToggleVoice,
  campusCenter,
}: CampusSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<
    'Todos' | BuildingCategory
  >('Todos');
  const [spaceKindFilter, setSpaceKindFilter] = useState<'Todos' | SpaceKind>(
    'Todos'
  );
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Assistant state
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantAnswer, setAssistantAnswer] = useState<string | null>(null);
  const [assistantChunks, setAssistantChunks] = useState<GroundingChunkItem[]>(
    []
  );
  const [assistantError, setAssistantError] = useState<string | null>(null);

  const pinnedLocations = useMemo(
    () => locations.filter((l) => l.location !== null),
    [locations]
  );

  const filteredLocations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return locations.filter((loc) => {
      if (selectedCategory !== 'Todos' && loc.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      const inHeader =
        loc.name.toLowerCase().includes(q) ||
        loc.code.toLowerCase().includes(q) ||
        loc.description.toLowerCase().includes(q);
      const inSpaces = loc.spaces.some(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.kind.toLowerCase().includes(q)
      );
      return inHeader || inSpaces;
    });
  }, [locations, searchQuery, selectedCategory]);

  const handleRequestGpsOrigin = () => {
    if (!navigator.geolocation) {
      setGpsError('Tu navegador no soporta geolocalización.');
      return;
    }
    setGpsLoading(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        const coords = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        onSetOriginEndpoint({
          label: 'Mi ubicación actual (GPS)',
          coords,
        });
        onFocusCoords(coords, 17);
      },
      () => {
        setGpsLoading(false);
        setGpsError(
          'No se pudo obtener tu ubicación. Puedes elegir un edificio o tocar el mapa.'
        );
      },
      {enableHighAccuracy: true, timeout: 10000}
    );
  };

  const askGroundingAssistant = async (promptText?: string) => {
    const query = (promptText ?? assistantInput).trim();
    if (!query) return;

    setAssistantInput(query);
    setAssistantLoading(true);
    setAssistantError(null);

    try {
      const res = await fetch('/api/maps-grounding', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          query,
          lat: campusCenter?.lat,
          lng: campusCenter?.lng,
        }),
      });
      const data = (await res.json()) as {
        text?: string;
        chunks?: GroundingChunkItem[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          data.error || 'Error al consultar Google Maps Grounding.'
        );
      }
      setAssistantAnswer(data.text ?? '');
      setAssistantChunks(data.chunks ?? []);
    } catch (err) {
      setAssistantError(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con el asistente.'
      );
    } finally {
      setAssistantLoading(false);
    }
  };

  const activeStep = computedRoute?.steps?.[activeStepIndex] ?? null;

  const googleMapsDirectionsUrl =
    originEndpoint && destinationEndpoint
      ? `https://www.google.com/maps/dir/?api=1&origin=${originEndpoint.coords.lat},${originEndpoint.coords.lng}&destination=${destinationEndpoint.coords.lat},${destinationEndpoint.coords.lng}&travelmode=${travelMode.toLowerCase()}`
      : null;

  return (
    <aside className="flex h-full w-full flex-col border-r border-slate-200 bg-white md:w-[400px] lg:w-[430px] shrink-0">
      {/* Segmented Workspace Tabs */}
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => onTabChange('explore')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'explore'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Edificios y Áreas
          </button>
          <button
            type="button"
            onClick={() => onTabChange('routes')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'routes'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Ruta Paso a Paso
          </button>
          <button
            type="button"
            onClick={() => onTabChange('assistant')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
              activeTab === 'assistant'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Guía Maps IA
          </button>
        </div>
      </div>

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'explore' && (
          <>
            {selectedLocation ? (
              <div className="p-4">
                <button
                  type="button"
                  onClick={() => onSelectLocation(null)}
                  className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Volver al directorio del campus
                </button>

                <div className="border-b border-slate-200 pb-4">
                  <div className="text-xs font-medium text-slate-500">
                    <span className="font-mono-tabular font-semibold text-[#6F1D3A]">
                      {selectedLocation.code}
                    </span>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span>{selectedLocation.category}</span>
                    <span className="mx-1.5" aria-hidden="true">
                      ·
                    </span>
                    <span>
                      {selectedLocation.source === 'google-place'
                        ? 'Verificado en Google Maps'
                        : selectedLocation.source === 'community-pin'
                          ? 'Pin comunitario'
                          : 'Pendiente de ubicación'}
                    </span>
                  </div>

                  <h2 className="mt-1.5 text-lg font-bold text-slate-900">
                    {selectedLocation.name}
                  </h2>

                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    {selectedLocation.description}
                  </p>

                  {selectedLocation.formattedAddress && (
                    <p className="mt-2 text-xs text-slate-500">
                      {selectedLocation.formattedAddress}
                    </p>
                  )}

                  {selectedLocation.accessibilityNotes && (
                    <p className="mt-2 text-xs text-slate-600">
                      Accesibilidad: {selectedLocation.accessibilityNotes}
                    </p>
                  )}

                  {selectedLocation.location ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onSetDestinationEndpoint({
                            label: selectedLocation.name,
                            coords: selectedLocation.location!,
                          });
                          onTabChange('routes');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#6F1D3A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#58162d] whitespace-nowrap"
                      >
                        <Navigation className="h-3.5 w-3.5" />
                        Cómo llegar aquí
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSetOriginEndpoint({
                            label: selectedLocation.name,
                            coords: selectedLocation.location!,
                          });
                          onTabChange('routes');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        Salir desde aquí
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditBuilding(selectedLocation)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Editar aulas y áreas
                      </button>
                      {selectedLocation.googleMapsURI && (
                        <a
                          href={selectedLocation.googleMapsURI}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Ver en Maps
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                      <p className="text-xs text-amber-950">
                        Este edificio aún no tiene coordenadas en el mapa.
                        Ayuda a la comunidad fijando su ubicación exacta.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onRequestPinBuilding(selectedLocation)}
                          className="inline-flex items-center gap-1.5 rounded-md bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 whitespace-nowrap"
                        >
                          <Crosshair className="h-3.5 w-3.5" />
                          Fijar pin en el mapa
                        </button>
                        <button
                          type="button"
                          onClick={() => onEditBuilding(selectedLocation)}
                          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100 whitespace-nowrap"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar info
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Interior Spaces: Aulas, Oficinas y Laboratorios */}
                <div className="pt-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-slate-900">
                      Oficinas, Aulas y Laboratorios
                    </h3>
                    <span className="font-mono-tabular text-xs text-slate-500">
                      {selectedLocation.spaces.length} registros
                    </span>
                  </div>

                  {selectedLocation.spaces.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1">
                      {(
                        [
                          'Todos',
                          'Aula',
                          'Laboratorio',
                          'Oficina',
                          'Servicio',
                          'Auditorio',
                        ] as const
                      ).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setSpaceKindFilter(kind)}
                          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                            spaceKindFilter === kind
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {kind}
                        </button>
                      ))}
                    </div>
                  )}

                  {selectedLocation.spaces.length === 0 ? (
                    <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-center">
                      <p className="text-xs text-slate-600">
                        Aún no hay oficinas, aulas ni laboratorios registrados
                        en este punto.
                      </p>
                      <button
                        type="button"
                        onClick={() => onEditBuilding(selectedLocation)}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Agregar áreas aquí
                      </button>
                    </div>
                  ) : (
                    <div className="mt-3 divide-y divide-slate-200 border-t border-b border-slate-200">
                      {selectedLocation.spaces
                        .filter(
                          (sp) =>
                            spaceKindFilter === 'Todos' ||
                            sp.kind === spaceKindFilter
                        )
                        .map((sp) => (
                          <div key={sp.id} className="py-2.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {sp.name}
                              </span>
                              <span className="font-mono-tabular shrink-0 text-xs font-semibold text-[#6F1D3A]">
                                {sp.code}
                              </span>
                            </div>
                            <div className="mt-0.5 text-xs text-slate-500">
                              <span>{sp.kind}</span>
                              <span className="mx-1.5" aria-hidden="true">
                                ·
                              </span>
                              <span>{sp.floor}</span>
                              {sp.schedule && (
                                <>
                                  <span className="mx-1.5" aria-hidden="true">
                                    ·
                                  </span>
                                  <span className="tabular-nums">
                                    {sp.schedule}
                                  </span>
                                </>
                              )}
                            </div>
                            {sp.notes && (
                              <p className="mt-1 text-xs text-slate-600">
                                {sp.notes}
                              </p>
                            )}
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4">
                {/* Search Input */}
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar edificio, aula, lab u oficina..."
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
                  />
                </div>

                {/* Category Filter Tabs */}
                <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        selectedCategory === cat
                          ? 'bg-[#6F1D3A] text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Summary Count */}
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span className="tabular-nums">
                    {filteredLocations.length}{' '}
                    {filteredLocations.length === 1
                      ? 'ubicación encontrada'
                      : 'ubicaciones encontradas'}
                  </span>
                  <span className="tabular-nums">
                    {pinnedLocations.length} en el mapa
                  </span>
                </div>

                {/* Building Cards List */}
                <div className="mt-2 divide-y divide-slate-200 border-t border-slate-200">
                  {filteredLocations.length === 0 ? (
                    <div className="py-8 text-center">
                      <Building2 className="mx-auto h-7 w-7 text-slate-300" />
                      <p className="mt-2 text-sm font-medium text-slate-700">
                        Sin coincidencias
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Prueba con otro nombre o agrega esta área desde
                        Contribuir.
                      </p>
                    </div>
                  ) : (
                    filteredLocations.map((loc) => (
                      <div
                        key={loc.id}
                        className="group py-3 transition-colors hover:bg-slate-50/70"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              onSelectLocation(loc);
                              if (loc.location) {
                                onFocusCoords(loc.location, 18);
                              }
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="font-mono-tabular font-semibold text-[#6F1D3A]">
                                {loc.code}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">{loc.category}</span>
                              {loc.spaces.length > 0 && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="tabular-nums shrink-0">
                                    {loc.spaces.length} áreas
                                  </span>
                                </>
                              )}
                            </div>
                            <h3 className="mt-0.5 text-sm font-semibold text-slate-900 group-hover:text-[#6F1D3A]">
                              {loc.name}
                            </h3>
                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                              {loc.description}
                            </p>
                          </button>

                          {loc.location ? (
                            <button
                              type="button"
                              title="Trazar ruta hacia aquí"
                              onClick={() => {
                                onSetDestinationEndpoint({
                                  label: loc.name,
                                  coords: loc.location!,
                                });
                                onTabChange('routes');
                              }}
                              className="mt-1 shrink-0 rounded-md border border-slate-200 bg-white p-2 text-slate-700 hover:border-[#6F1D3A] hover:text-[#6F1D3A]"
                            >
                              <Navigation className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onRequestPinBuilding(loc)}
                              className="mt-1 shrink-0 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap"
                            >
                              Ubicar
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'routes' && (
          <div className="p-4">
            <h2 className="text-base font-bold text-slate-900">
              Navegación guiada paso a paso
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Traza rutas dentro y alrededor del Instituto Tecnológico de
              Durango.
            </p>

            {/* Origin Selector */}
            <div className="mt-4 space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Punto de origen (A)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRequestGpsOrigin}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#6F1D3A] hover:underline"
                    >
                      <LocateFixed className="h-3 w-3" />
                      {gpsLoading ? 'Obteniendo...' : 'Mi GPS'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onPickMapPoint('origin')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline"
                    >
                      <Crosshair className="h-3 w-3" />
                      Clic en mapa
                    </button>
                  </div>
                </div>
                <select
                  value={
                    pinnedLocations.find(
                      (l) =>
                        l.location?.lat === originEndpoint?.coords.lat &&
                        l.location?.lng === originEndpoint?.coords.lng
                    )?.id ?? ''
                  }
                  onChange={(e) => {
                    const found = pinnedLocations.find(
                      (l) => l.id === e.target.value
                    );
                    if (found?.location) {
                      onSetOriginEndpoint({
                        label: found.name,
                        coords: found.location,
                      });
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
                >
                  <option value="">
                    {originEndpoint
                      ? originEndpoint.label
                      : 'Selecciona edificio o punto de salida...'}
                  </option>
                  {pinnedLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.code} — {loc.name}
                    </option>
                  ))}
                </select>
                {gpsError && (
                  <p className="mt-1 text-xs text-amber-800">{gpsError}</p>
                )}
              </div>

              {/* Swap Button */}
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={onSwapEndpoints}
                  disabled={!originEndpoint && !destinationEndpoint}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  <ArrowDownUp className="h-3.5 w-3.5" />
                  Intercambiar
                </button>
              </div>

              {/* Destination Selector */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700">
                    Punto de destino (B)
                  </label>
                  <button
                    type="button"
                    onClick={() => onPickMapPoint('destination')}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:underline"
                  >
                    <Crosshair className="h-3 w-3" />
                    Clic en mapa
                  </button>
                </div>
                <select
                  value={
                    pinnedLocations.find(
                      (l) =>
                        l.location?.lat === destinationEndpoint?.coords.lat &&
                        l.location?.lng === destinationEndpoint?.coords.lng
                    )?.id ?? ''
                  }
                  onChange={(e) => {
                    const found = pinnedLocations.find(
                      (l) => l.id === e.target.value
                    );
                    if (found?.location) {
                      onSetDestinationEndpoint({
                        label: found.name,
                        coords: found.location,
                      });
                    }
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
                >
                  <option value="">
                    {destinationEndpoint
                      ? destinationEndpoint.label
                      : 'Selecciona edificio o área destino...'}
                  </option>
                  {pinnedLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.code} — {loc.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Travel Mode Segmented Control */}
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => onChangeTravelMode('WALKING')}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    travelMode === 'WALKING'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Footprints className="h-3.5 w-3.5" />A pie
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTravelMode('BICYCLING')}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    travelMode === 'BICYCLING'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Bike className="h-3.5 w-3.5" />
                  Bici
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTravelMode('DRIVING')}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                    travelMode === 'DRIVING'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Car className="h-3.5 w-3.5" />
                  Auto
                </button>
              </div>
            </div>

            {/* Route State Display */}
            {routeLoading && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs font-medium text-slate-600">
                Calculando ruta paso a paso con Google Routes API...
              </div>
            )}

            {routeError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {routeError}
              </div>
            )}

            {computedRoute && !routeLoading && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono-tabular text-lg font-bold text-slate-900">
                      {computedRoute.durationText}
                    </div>
                    <div className="font-mono-tabular text-xs text-slate-500">
                      Distancia total: {computedRoute.distanceText} ·{' '}
                      {computedRoute.steps.length} pasos
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={onToggleVoice}
                      title={
                        voiceEnabled
                          ? 'Silenciar indicaciones por voz'
                          : 'Activar indicaciones por voz'
                      }
                      className={`rounded-lg border p-2 ${
                        voiceEnabled
                          ? 'border-[#6F1D3A] bg-[#6F1D3A]/10 text-[#6F1D3A]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {voiceEnabled ? (
                        <Volume2 className="h-4 w-4" />
                      ) : (
                        <VolumeX className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleGuided(!guidedActive)}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap ${
                        guidedActive
                          ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                          : 'bg-[#6F1D3A] text-white hover:bg-[#58162d]'
                      }`}
                    >
                      {guidedActive ? 'Detener guía' : 'Iniciar guía'}
                    </button>
                  </div>
                </div>

                {/* Active Guided Step Card */}
                {guidedActive && activeStep && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                      <span className="font-mono-tabular">
                        Paso {activeStepIndex + 1} de{' '}
                        {computedRoute.steps.length}
                      </span>
                      <span className="font-mono-tabular text-[#6F1D3A]">
                        {activeStep.distanceText}
                      </span>
                    </div>
                    <div className="mt-2 flex items-start gap-3">
                      <div className="mt-0.5 rounded-md border border-slate-200 bg-white p-2">
                        {renderManeuverIcon(activeStep.maneuver)}
                      </div>
                      <p className="text-sm font-semibold leading-snug text-slate-900">
                        {activeStep.instruction}
                      </p>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={activeStepIndex <= 0}
                        onClick={() => onSelectStep(activeStepIndex - 1)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Anterior
                      </button>
                      <button
                        type="button"
                        disabled={
                          activeStepIndex >= computedRoute.steps.length - 1
                        }
                        onClick={() => onSelectStep(activeStepIndex + 1)}
                        className="inline-flex items-center gap-1 rounded-md bg-[#6F1D3A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#58162d] disabled:opacity-40"
                      >
                        Siguiente
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Complete Step-by-Step List */}
                <div className="mt-3 divide-y divide-slate-200 border-t border-slate-200">
                  {computedRoute.steps.map((step, idx) => {
                    const isCurrent = guidedActive && idx === activeStepIndex;
                    return (
                      <button
                        key={step.index}
                        type="button"
                        onClick={() => {
                          if (!guidedActive) onToggleGuided(true);
                          onSelectStep(idx);
                        }}
                        className={`flex w-full items-start gap-3 py-2.5 text-left transition-colors ${
                          isCurrent ? 'bg-amber-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`font-mono-tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                            isCurrent
                              ? 'bg-amber-600 text-white'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium leading-relaxed text-slate-900">
                            {step.instruction}
                          </div>
                          <div className="font-mono-tabular mt-0.5 text-[11px] text-slate-500">
                            {step.distanceText} · {step.durationText}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {googleMapsDirectionsUrl && (
                  <a
                    href={googleMapsDirectionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir ruta en Google Maps
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'assistant' && (
          <div className="p-4">
            <h2 className="text-base font-bold text-slate-900">
              Guía del Campus con Google Maps
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Consulta ubicaciones reales del ITD, accesos y lugares cercanos
              respaldados con datos de Google Maps.
            </p>

            {/* Quick Suggested Queries */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                '¿Cuáles son las entradas y edificios principales del Instituto Tecnológico de Durango?',
                '¿Qué papelerías, cafés o bancos hay cerca del ITD?',
                '¿Dónde queda el Centro de Información del Tecnológico de Durango?',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => askGroundingAssistant(suggestion)}
                  className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs text-slate-700 hover:border-[#6F1D3A] hover:bg-white"
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                askGroundingAssistant();
              }}
              className="mt-3 flex gap-2"
            >
              <input
                type="text"
                value={assistantInput}
                onChange={(e) => setAssistantInput(e.target.value)}
                placeholder="Pregunta sobre edificios o alrededores del ITD..."
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#6F1D3A] focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={assistantLoading || !assistantInput.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#6F1D3A] px-3 py-2 text-xs font-semibold text-white hover:bg-[#58162d] disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                Consultar
              </button>
            </form>

            {assistantLoading && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                Consultando datos en vivo de Google Maps...
              </div>
            )}

            {assistantError && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                {assistantError}
              </div>
            )}

            {assistantAnswer && !assistantLoading && (
              <div className="mt-4 space-y-4 border-t border-slate-200 pt-4">
                <div className="prose prose-sm max-w-none text-slate-800 prose-a:text-[#6F1D3A] prose-headings:text-slate-900">
                  <Markdown>{assistantAnswer}</Markdown>
                </div>

                {assistantChunks.length > 0 && (
                  <div className="border-t border-slate-200 pt-3">
                    <h3 className="text-xs font-bold text-slate-900">
                      Lugares en Google Maps referenciados
                    </h3>
                    <div className="mt-2 space-y-2">
                      {assistantChunks.map((chunk, idx) => (
                        <div
                          key={`${chunk.title}-${idx}`}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900">
                              {chunk.title}
                            </span>
                            {chunk.uri && (
                              <a
                                href={chunk.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#6F1D3A] hover:underline"
                              >
                                Abrir en Maps
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {chunk.reviewSnippets.length > 0 && (
                            <div className="mt-1.5 space-y-1 border-t border-slate-200 pt-1.5">
                              {chunk.reviewSnippets.map((rev, rIdx) => (
                                <div key={rIdx} className="text-[11px] text-slate-600">
                                  {rev.text && <p>"{rev.text}"</p>}
                                  {rev.uri && (
                                    <a
                                      href={rev.uri}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-[#6F1D3A] hover:underline"
                                    >
                                      {rev.author ? `Reseña de ${rev.author}` : 'Ver reseña en Maps'}
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
