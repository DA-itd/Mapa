import {useCallback, useEffect, useMemo, useState} from 'react';
import {APIProvider} from '@vis.gl/react-google-maps';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {LocateFixed, PanelLeftClose, PanelLeftOpen, Plus} from 'lucide-react';
import campusDirectorySeed from './data/campus-directory.json';
import {CampusMapView, type MapPickMode} from './components/CampusMapView';
import {
  CampusSidebar,
  type RouteEndpoint,
  type SidebarTab,
} from './components/CampusSidebar';
import {ContributeModal} from './components/ContributeModal';
import {FieldSurveyPanel} from './components/FieldSurveyPanel';
import {auth, googleProvider} from './firebase';
import type {
  CampusBuildingEntry,
  CampusSpace,
  ComputedRouteResult,
  DiscoveredGooglePlace,
  ResolvedCampusLocation,
  TravelModeOption,
} from './types/campus';
import {
  clearLocalBuildings,
  hasLocalOverrides,
  loadLocalBuildings,
  mergeCampusLocations,
  saveLocalBuildings,
} from './utils/campusStorage';
import {
  deleteCloudSpaceById,
  mergeCloudIntoBuildings,
  saveCloudBuildingWithSpaces,
  saveCloudSurveyPoint,
  subscribeCampusCloudData,
  syncBatchToCloud,
  type CloudBuildingDoc,
  type CloudSpaceDoc,
} from './utils/firestoreCampus';

const BASE_BUILDINGS =
  campusDirectorySeed.buildings as CampusBuildingEntry[];

export default function App() {
  const [mapsApiKey, setMapsApiKey] = useState<string>(
    () => (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ?? ''
  );
  const [keyLoading, setKeyLoading] = useState<boolean>(!mapsApiKey);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);

  // Community directory & discovered Google Places
  const [buildings, setBuildings] = useState<CampusBuildingEntry[]>(() =>
    loadLocalBuildings(BASE_BUILDINGS)
  );
  const [localDirty, setLocalDirty] = useState<boolean>(() =>
    hasLocalOverrides()
  );
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [cloudBuildings, setCloudBuildings] = useState<
    Map<string, CloudBuildingDoc>
  >(() => new Map());
  const [cloudSpaces, setCloudSpaces] = useState<Map<string, CloudSpaceDoc>>(
    () => new Map()
  );
  const [cloudSyncing, setCloudSyncing] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [discoveredPlaces, setDiscoveredPlaces] = useState<
    DiscoveredGooglePlace[]
  >([]);
  const [campusCenter, setCampusCenter] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  // UI navigation state
  const [activeTab, setActiveTab] = useState<SidebarTab>('explore');
  const [surveyMode, setSurveyMode] = useState<boolean>(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(
    null
  );
  const [focusTarget, setFocusTarget] = useState<{
    lat: number;
    lng: number;
    zoom?: number;
    ts: number;
  } | null>(null);

  // Routing & step-by-step guidance state
  const [originEndpoint, setOriginEndpoint] = useState<RouteEndpoint | null>(
    null
  );
  const [destinationEndpoint, setDestinationEndpoint] =
    useState<RouteEndpoint | null>(null);
  const [travelMode, setTravelMode] = useState<TravelModeOption>('WALKING');
  const [computedRoute, setComputedRoute] =
    useState<ComputedRouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [guidedActive, setGuidedActive] = useState<boolean>(false);
  const [activeStepIndex, setActiveStepIndex] = useState<number>(0);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(false);

  // Map pick & Contribute modal state
  const [mapPickMode, setMapPickMode] = useState<MapPickMode>('none');
  const [contributeOpen, setContributeOpen] = useState<boolean>(false);
  const [editingBuildingId, setEditingBuildingId] = useState<string | null>(
    null
  );
  const [pendingDraft, setPendingDraft] = useState<CampusBuildingEntry | null>(
    null
  );
  const [pickedBuildingCoords, setPickedBuildingCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [pickReturnTarget, setPickReturnTarget] = useState<'modal' | 'survey'>(
    'modal'
  );

  useEffect(() => {
    const onQuotaExceeded = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () =>
      window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
  }, []);

  useEffect(() => {
    if (mapsApiKey) {
      setKeyLoading(false);
      return;
    }
    let cancelled = false;
    fetch('/api/maps-config')
      .then((res) => res.json())
      .then((data: {apiKey?: string}) => {
        if (!cancelled && data.apiKey) {
          setMapsApiKey(data.apiKey);
        }
      })
      .catch(() => {
        // Handled cleanly by empty key state
      })
      .finally(() => {
        if (!cancelled) setKeyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady) return;
    const unsub = subscribeCampusCloudData((nextBuildings, nextSpaces) => {
      setCloudBuildings(nextBuildings);
      setCloudSpaces(nextSpaces);
    });
    return () => unsub();
  }, [authReady]);

  const effectiveBuildings = useMemo(
    () => mergeCloudIntoBuildings(buildings, cloudBuildings, cloudSpaces),
    [buildings, cloudBuildings, cloudSpaces]
  );

  const resolvedLocations = useMemo(
    () => mergeCampusLocations(effectiveBuildings, discoveredPlaces),
    [effectiveBuildings, discoveredPlaces]
  );

  const selectedLocation = useMemo(
    () =>
      resolvedLocations.find((loc) => loc.id === selectedLocationId) ?? null,
    [resolvedLocations, selectedLocationId]
  );

  const handlePlacesDiscovered = useCallback(
    (
      places: DiscoveredGooglePlace[],
      center: {lat: number; lng: number} | null
    ) => {
      setDiscoveredPlaces(places);
      if (center) {
        setCampusCenter(center);
      }
    },
    []
  );

  const handleFocusCoords = useCallback(
    (coords: {lat: number; lng: number}, zoom?: number) => {
      setFocusTarget({lat: coords.lat, lng: coords.lng, zoom, ts: Date.now()});
    },
    []
  );

  const handleRouteComputed = useCallback(
    (route: ComputedRouteResult | null) => {
      setComputedRoute(route);
      setActiveStepIndex(0);
      if (!route) {
        setGuidedActive(false);
      }
    },
    []
  );

  const handleSelectStep = useCallback(
    (idx: number) => {
      if (!computedRoute || idx < 0 || idx >= computedRoute.steps.length) {
        return;
      }
      setActiveStepIndex(idx);
      const stepLoc = computedRoute.steps[idx]?.startLocation;
      if (stepLoc) {
        handleFocusCoords(stepLoc, 18);
      }
    },
    [computedRoute, handleFocusCoords]
  );

  useEffect(() => {
    if (
      !guidedActive ||
      !voiceEnabled ||
      typeof window === 'undefined' ||
      !('speechSynthesis' in window)
    ) {
      return;
    }
    const step = computedRoute?.steps?.[activeStepIndex];
    if (!step) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      `${step.instruction}. En ${step.distanceText}.`
    );
    utterance.lang = 'es-MX';
    window.speechSynthesis.speak(utterance);
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [guidedActive, voiceEnabled, computedRoute, activeStepIndex]);

  const handleMapPick = useCallback(
    (coords: {lat: number; lng: number}) => {
      if (mapPickMode === 'origin') {
        setOriginEndpoint({
          label: `Punto en mapa (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`,
          coords,
        });
        setMapPickMode('none');
      } else if (mapPickMode === 'destination') {
        setDestinationEndpoint({
          label: `Punto en mapa (${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)})`,
          coords,
        });
        setMapPickMode('none');
      } else if (mapPickMode === 'pin-building') {
        setPickedBuildingCoords(coords);
        setMapPickMode('none');
        if (pickReturnTarget === 'survey') {
          setSurveyMode(true);
        } else {
          setContributeOpen(true);
        }
      }
    },
    [mapPickMode, pickReturnTarget]
  );

  const handleEditBuilding = useCallback(
    (loc: ResolvedCampusLocation) => {
      if (loc.communityEntryId) {
        setPendingDraft(null);
        setEditingBuildingId(loc.communityEntryId);
      } else {
        setEditingBuildingId(null);
        setPendingDraft({
          id: `itd-${loc.name
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')}`,
          code: loc.code === 'GM' ? 'ITD' : loc.code,
          name: loc.name,
          category: loc.category,
          description: loc.description,
          matchKeywords: [loc.name.toLowerCase()],
          placeId: loc.placeId,
          customLatLng: loc.location,
          spaces: loc.spaces,
        });
      }
      setPickedBuildingCoords(null);
      setContributeOpen(true);
    },
    []
  );

  const handleRequestPinBuilding = useCallback((loc: ResolvedCampusLocation) => {
    setSurveyMode(false);
    setPickReturnTarget('modal');
    setPendingDraft(null);
    setEditingBuildingId(loc.communityEntryId ?? null);
    setMapPickMode('pin-building');
  }, []);

  const handleRequestMapPickForDraft = useCallback(
    (draft: CampusBuildingEntry) => {
      setSurveyMode(false);
      setPickReturnTarget('modal');
      setPendingDraft(draft);
      setContributeOpen(false);
      setMapPickMode('pin-building');
    },
    []
  );

  const handleSaveBuildings = useCallback((updated: CampusBuildingEntry[]) => {
    setBuildings(updated);
    saveLocalBuildings(updated);
    setLocalDirty(true);
  }, []);

  const handleSignInGoogle = useCallback(async () => {
    setCloudError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'No se pudo iniciar sesión.';
      if (!msg.includes('popup-closed-by-user')) {
        setCloudError('No se pudo conectar con Google. Intenta nuevamente.');
      }
    }
  }, []);

  const handleSignOutGoogle = useCallback(async () => {
    setCloudError(null);
    await signOut(auth);
  }, []);

  const handleCloudSaveBuilding = useCallback(
    async (building: CampusBuildingEntry) => {
      if (!authUser || !authUser.emailVerified) return;
      setCloudSyncing(true);
      setCloudError(null);
      try {
        await saveCloudBuildingWithSpaces({
          building,
          uid: authUser.uid,
          displayName: authUser.displayName ?? undefined,
          cloudBuildings,
          cloudSpaces,
        });
      } finally {
        setCloudSyncing(false);
      }
    },
    [authUser, cloudBuildings, cloudSpaces]
  );

  const handleCloudSaveSurveyPoint = useCallback(
    async (
      building: CampusBuildingEntry,
      newSpace: CampusSpace | null,
      surveyorLabel?: string
    ) => {
      if (!authUser || !authUser.emailVerified) return;
      setCloudSyncing(true);
      setCloudError(null);
      try {
        await saveCloudSurveyPoint({
          building,
          newSpace,
          uid: authUser.uid,
          displayName:
            surveyorLabel?.trim() || authUser.displayName || undefined,
          cloudBuildings,
        });
      } finally {
        setCloudSyncing(false);
      }
    },
    [authUser, cloudBuildings]
  );

  const handleCloudDeleteSpace = useCallback(
    async (spaceId: string) => {
      if (!authUser || !authUser.emailVerified || !cloudSpaces.has(spaceId)) {
        return;
      }
      setCloudSyncing(true);
      try {
        await deleteCloudSpaceById(spaceId);
      } finally {
        setCloudSyncing(false);
      }
    },
    [authUser, cloudSpaces]
  );

  const handleCloudSyncBatch = useCallback(
    async (listToSync: CampusBuildingEntry[], uploaderLabel?: string) => {
      if (!authUser || !authUser.emailVerified) {
        return {buildingsSynced: 0, spacesSynced: 0};
      }
      setCloudSyncing(true);
      setCloudError(null);
      try {
        return await syncBatchToCloud({
          buildings: listToSync,
          uid: authUser.uid,
          displayName:
            uploaderLabel?.trim() || authUser.displayName || undefined,
          cloudBuildings,
          cloudSpaces,
        });
      } finally {
        setCloudSyncing(false);
      }
    },
    [authUser, cloudBuildings, cloudSpaces]
  );

  const handleResetToRepo = useCallback(() => {
    clearLocalBuildings();
    setBuildings(BASE_BUILDINGS);
    setLocalDirty(false);
    setPickedBuildingCoords(null);
    setPendingDraft(null);
  }, []);

  const handleSwapEndpoints = useCallback(() => {
    setOriginEndpoint(destinationEndpoint);
    setDestinationEndpoint(originEndpoint);
  }, [originEndpoint, destinationEndpoint]);

  const activeStepLocation =
    guidedActive && computedRoute?.steps?.[activeStepIndex]?.startLocation
      ? computedRoute.steps[activeStepIndex].startLocation
      : null;

  const isSurveyActive = !keyLoading && (surveyMode || !mapsApiKey);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50 text-slate-900">
      {/* Required Case A Quota Banner */}
      {quotaExceeded && (
        <div className="sticky top-0 z-50 border-b border-amber-200 bg-amber-50 px-4 py-2.5 text-center text-xs text-amber-900 shadow-sm md:text-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-amber-950 underline hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* 3-Zone Top Bar (Hidden in Brigada GPS mode to keep screen clean and distraction-free) */}
      {!isSurveyActive && (
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-3 md:gap-8 md:px-6">
          <a
            href="/"
            className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 md:text-lg"
          >
            Mapa Campus ITD
          </a>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <button
              type="button"
              onClick={() => {
                setSurveyMode(false);
                setActiveTab('explore');
                setSidebarOpen(true);
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
                activeTab === 'explore' ? 'font-semibold text-[#6F1D3A]' : ''
              }`}
            >
              Explorar
            </button>
            <button
              type="button"
              onClick={() => {
                setSurveyMode(false);
                setActiveTab('routes');
                setSidebarOpen(true);
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
                activeTab === 'routes' ? 'font-semibold text-[#6F1D3A]' : ''
              }`}
            >
              Rutas
            </button>
            <button
              type="button"
              onClick={() => {
                setSurveyMode(false);
                setActiveTab('assistant');
                setSidebarOpen(true);
              }}
              className={`whitespace-nowrap shrink-0 transition-colors hover:text-slate-900 ${
                activeTab === 'assistant' ? 'font-semibold text-[#6F1D3A]' : ''
              }`}
            >
              Guía Maps
            </button>
            <button
              type="button"
              onClick={() => setSurveyMode(true)}
              className="whitespace-nowrap shrink-0 transition-colors hover:text-slate-900"
            >
              Brigada GPS
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSurveyMode(true)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 md:hidden"
            >
              <LocateFixed className="h-3.5 w-3.5 text-[#6F1D3A]" />
              Brigada
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label="Alternar panel lateral"
              className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50 md:hidden"
            >
              {sidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingDraft(null);
                setEditingBuildingId(selectedLocation?.communityEntryId ?? null);
                setContributeOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#6F1D3A] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#58162d] whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Contribuir
            </button>
          </div>
        </header>
      )}

      {/* Main Split Workspace (or Isolated Brigada GPS Box) */}
      <main className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        {!isSurveyActive && sidebarOpen && (
          <div className="h-[46dvh] min-h-0 w-full shrink-0 md:h-full md:w-auto">
            <CampusSidebar
              activeTab={activeTab}
              onTabChange={setActiveTab}
              locations={resolvedLocations}
              selectedLocation={selectedLocation}
              onSelectLocation={(loc) => setSelectedLocationId(loc?.id ?? null)}
              onFocusCoords={handleFocusCoords}
              onEditBuilding={handleEditBuilding}
              onRequestPinBuilding={handleRequestPinBuilding}
              originEndpoint={originEndpoint}
              destinationEndpoint={destinationEndpoint}
              onSetOriginEndpoint={setOriginEndpoint}
              onSetDestinationEndpoint={setDestinationEndpoint}
              onSwapEndpoints={handleSwapEndpoints}
              onPickMapPoint={(target) => setMapPickMode(target)}
              travelMode={travelMode}
              onChangeTravelMode={setTravelMode}
              computedRoute={computedRoute}
              routeLoading={routeLoading}
              routeError={routeError}
              guidedActive={guidedActive}
              onToggleGuided={(active) => setGuidedActive(active)}
              activeStepIndex={activeStepIndex}
              onSelectStep={handleSelectStep}
              voiceEnabled={voiceEnabled}
              onToggleVoice={() => setVoiceEnabled((v) => !v)}
              campusCenter={campusCenter}
            />
          </div>
        )}

        {/* Map / Field Survey Viewport */}
        <section
          className={`relative min-h-0 flex-1 ${
            isSurveyActive
              ? 'bg-slate-50'
              : 'min-h-[260px] bg-slate-200 md:min-h-0'
          }`}
        >
          {keyLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              Cargando configuración del mapa...
            </div>
          ) : isSurveyActive ? (
            <FieldSurveyPanel
              buildings={effectiveBuildings}
              onSaveBuildings={handleSaveBuildings}
              hasMapsKey={Boolean(mapsApiKey)}
              onExitSurvey={() => setSurveyMode(false)}
              pickedCoords={pickedBuildingCoords}
              onClearPickedCoords={() => setPickedBuildingCoords(null)}
              onRequestMapPick={() => {
                setPickReturnTarget('survey');
                setSurveyMode(false);
                setMapPickMode('pin-building');
              }}
              onFocusCoords={handleFocusCoords}
              cloudUser={
                authUser && authUser.emailVerified
                  ? {
                      uid: authUser.uid,
                      displayName: authUser.displayName || authUser.email || 'Brigadista',
                    }
                  : null
              }
              cloudSyncing={cloudSyncing}
              cloudError={cloudError}
              cloudSpacesCount={cloudSpaces.size}
              onSignInGoogle={handleSignInGoogle}
              onSignOutGoogle={handleSignOutGoogle}
              onCloudSaveSurveyPoint={handleCloudSaveSurveyPoint}
              onCloudDeleteSpace={handleCloudDeleteSpace}
              onCloudSyncBatch={handleCloudSyncBatch}
            />
          ) : (
            <APIProvider
              apiKey={mapsApiKey}
              libraries={['places', 'routes', 'marker']}
              language="es"
              region="MX"
            >
              <CampusMapView
                locations={resolvedLocations}
                selectedLocationId={selectedLocationId}
                onSelectLocation={(loc) => {
                  setSelectedLocationId(loc.id);
                  setActiveTab('explore');
                  setSidebarOpen(true);
                }}
                onPlacesDiscovered={handlePlacesDiscovered}
                mapPickMode={mapPickMode}
                onMapPick={handleMapPick}
                onCancelMapPick={() => setMapPickMode('none')}
                routeOrigin={originEndpoint?.coords ?? null}
                routeDestination={destinationEndpoint?.coords ?? null}
                travelMode={travelMode}
                activeStepIndex={activeStepIndex}
                activeStepLocation={activeStepLocation}
                onRouteComputed={handleRouteComputed}
                onRouteLoading={setRouteLoading}
                onRouteError={setRouteError}
                onStartRouteTo={(loc) => {
                  if (loc.location) {
                    setDestinationEndpoint({
                      label: loc.name,
                      coords: loc.location,
                    });
                    setActiveTab('routes');
                    setSidebarOpen(true);
                  }
                }}
                focusTarget={focusTarget}
              />
            </APIProvider>
          )}
        </section>
      </main>

      <ContributeModal
        isOpen={contributeOpen}
        onClose={() => {
          setContributeOpen(false);
          setPendingDraft(null);
        }}
        buildings={effectiveBuildings}
        editingBuildingId={editingBuildingId}
        pickedCoords={pickedBuildingCoords}
        onClearPickedCoords={() => setPickedBuildingCoords(null)}
        onRequestMapPickForBuilding={handleRequestMapPickForDraft}
        onSaveBuildings={handleSaveBuildings}
        onResetToRepo={handleResetToRepo}
        hasLocalChanges={localDirty}
        initialDraft={pendingDraft}
        cloudUser={
          authUser && authUser.emailVerified
            ? {
                uid: authUser.uid,
                displayName: authUser.displayName || authUser.email || 'Brigadista',
              }
            : null
        }
        cloudSyncing={cloudSyncing}
        cloudError={cloudError}
        onSignInGoogle={handleSignInGoogle}
        onSignOutGoogle={handleSignOutGoogle}
        onCloudSaveBuilding={handleCloudSaveBuilding}
        onCloudSyncBatch={handleCloudSyncBatch}
      />
    </div>
  );
}
