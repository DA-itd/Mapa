import {useCallback, useEffect, useRef, useState} from 'react';
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  InfoWindow,
  Map as GoogleMapView,
  type MapMouseEvent,
  useAdvancedMarkerRef,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {Compass, ExternalLink, Layers, MapPin, Navigation} from 'lucide-react';
import type {
  ComputedRouteResult,
  DiscoveredGooglePlace,
  ResolvedCampusLocation,
  TravelModeOption,
} from '../types/campus';
import {RouteGuideLayer} from './RouteGuideLayer';

export type MapPickMode = 'none' | 'origin' | 'destination' | 'pin-building';

interface CampusMapViewProps {
  locations: ResolvedCampusLocation[];
  selectedLocationId: string | null;
  onSelectLocation: (loc: ResolvedCampusLocation) => void;
  onPlacesDiscovered: (
    places: DiscoveredGooglePlace[],
    campusCenter: {lat: number; lng: number} | null
  ) => void;
  mapPickMode: MapPickMode;
  onMapPick: (coords: {lat: number; lng: number}) => void;
  onCancelMapPick: () => void;
  routeOrigin: {lat: number; lng: number} | null;
  routeDestination: {lat: number; lng: number} | null;
  travelMode: TravelModeOption;
  activeStepIndex: number;
  activeStepLocation: {lat: number; lng: number} | null;
  onRouteComputed: (route: ComputedRouteResult | null) => void;
  onRouteLoading: (loading: boolean) => void;
  onRouteError: (error: string | null) => void;
  onStartRouteTo: (loc: ResolvedCampusLocation) => void;
  focusTarget: {lat: number; lng: number; zoom?: number; ts: number} | null;
}

interface MarkerItemProps {
  loc: ResolvedCampusLocation;
  isSelected: boolean;
  onMarkerClick: (
    loc: ResolvedCampusLocation,
    marker: google.maps.marker.AdvancedMarkerElement
  ) => void;
}

function CampusMarkerItem({loc, isSelected, onMarkerClick}: MarkerItemProps) {
  const [markerRef, marker] = useAdvancedMarkerRef();

  if (!loc.location) return null;

  const isCommunity = loc.source === 'community-pin';
  const hasSpaces = loc.spaces.length > 0;

  return (
    <AdvancedMarker
      ref={markerRef}
      position={loc.location}
      zIndex={isSelected ? 1100 : hasSpaces ? 500 : 100}
      anchorPoint={AdvancedMarkerAnchorPoint.BOTTOM}
      title={loc.name}
      onClick={() => {
        if (marker) {
          onMarkerClick(loc, marker);
        }
      }}
    >
      <div
        className={`group flex cursor-pointer flex-col items-center transition-transform duration-150 ${
          isSelected ? 'scale-110' : 'hover:scale-105'
        }`}
      >
        <div
          className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold shadow-sm ${
            isSelected
              ? 'border-[#4a1025] bg-[#6F1D3A] text-white'
              : isCommunity
                ? 'border-teal-800 bg-teal-700 text-white'
                : hasSpaces
                  ? 'border-slate-300 bg-white text-slate-900'
                  : 'border-slate-300 bg-slate-50/95 text-slate-700'
          }`}
        >
          <span
            className={`font-mono-tabular text-[11px] font-bold ${
              isSelected || isCommunity ? 'text-white/90' : 'text-[#6F1D3A]'
            }`}
          >
            {loc.code}
          </span>
          <span className="max-w-[130px] truncate">{loc.name}</span>
        </div>
        <div
          className={`h-2 w-2 -translate-y-1 rotate-45 border-r border-b ${
            isSelected
              ? 'border-[#4a1025] bg-[#6F1D3A]'
              : isCommunity
                ? 'border-teal-800 bg-teal-700'
                : 'border-slate-300 bg-white'
          }`}
        />
      </div>
    </AdvancedMarker>
  );
}

const DURANGO_FALLBACK_CENTER = {lat: 24.0277, lng: -104.6532};

export function CampusMapView({
  locations,
  selectedLocationId,
  onSelectLocation,
  onPlacesDiscovered,
  mapPickMode,
  onMapPick,
  onCancelMapPick,
  routeOrigin,
  routeDestination,
  travelMode,
  activeStepIndex,
  activeStepLocation,
  onRouteComputed,
  onRouteLoading,
  onRouteError,
  onStartRouteTo,
  focusTarget,
}: CampusMapViewProps) {
  const map = useMap();
  const placesLib = useMapsLibrary('places');

  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'hybrid'>('roadmap');
  const [infoLoc, setInfoLoc] = useState<ResolvedCampusLocation | null>(null);
  const [infoAnchor, setInfoAnchor] =
    useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [campusBounds, setCampusBounds] = useState<google.maps.LatLngBounds | null>(
    null
  );
  const [discoveryStatus, setDiscoveryStatus] = useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle');

  const discoveredOnceRef = useRef(false);

  const runCampusDiscovery = useCallback(async () => {
    if (!placesLib || !map) return;
    setDiscoveryStatus('loading');

    try {
      const PlaceClass = placesLib.Place as unknown as {
        searchByText: (req: unknown) => Promise<{
          places?: Array<{
            id: string;
            displayName?: string;
            formattedAddress?: string;
            location?: google.maps.LatLng;
            viewport?: google.maps.LatLngBounds;
            googleMapsURI?: string;
            primaryType?: string;
            types?: string[];
          }>;
        }>;
        searchNearby: (req: unknown) => Promise<{
          places?: Array<{
            id: string;
            displayName?: string;
            formattedAddress?: string;
            location?: google.maps.LatLng;
            googleMapsURI?: string;
            primaryType?: string;
            types?: string[];
          }>;
        }>;
      };

      const mainRes = await PlaceClass.searchByText({
        textQuery:
          'Instituto Tecnológico de Durango, Blvd. Felipe Pescador 1830, Durango',
        fields: [
          'id',
          'displayName',
          'location',
          'viewport',
          'formattedAddress',
          'googleMapsURI',
          'primaryType',
          'types',
        ],
        language: 'es',
        region: 'MX',
      });

      const itdMain = mainRes.places?.[0];
      const anchorLatLng = itdMain?.location
        ? {lat: itdMain.location.lat(), lng: itdMain.location.lng()}
        : null;

      if (itdMain?.viewport) {
        setCampusBounds(itdMain.viewport);
        map.fitBounds(itdMain.viewport);
      } else if (anchorLatLng) {
        map.panTo(anchorLatLng);
        map.setZoom(17);
      }

      const collected: Record<string, DiscoveredGooglePlace> = {};

      const addPlaces = (
        list:
          | Array<{
              id: string;
              displayName?: string;
              formattedAddress?: string;
              location?: google.maps.LatLng;
              googleMapsURI?: string;
              primaryType?: string;
              types?: string[];
            }>
          | undefined
      ) => {
        if (!list) return;
        for (const p of list) {
          if (!p.id || !p.location) continue;
          collected[p.id] = {
            placeId: p.id,
            displayName: p.displayName || 'Área del Campus ITD',
            formattedAddress: p.formattedAddress || '',
            location: {lat: p.location.lat(), lng: p.location.lng()},
            googleMapsURI: p.googleMapsURI,
            primaryType: p.primaryType,
            types: p.types,
          };
        }
      };

      addPlaces(mainRes.places);

      const buildingQueries = [
        'Instituto Tecnológico de Durango biblioteca centro de información centro de cómputo',
        'Instituto Tecnológico de Durango gimnasio auditorio edificios laboratorios',
      ];

      const extraResults = await Promise.allSettled(
        buildingQueries.map((q) =>
          PlaceClass.searchByText({
            textQuery: q,
            fields: [
              'id',
              'displayName',
              'location',
              'formattedAddress',
              'googleMapsURI',
              'primaryType',
              'types',
            ],
            ...(anchorLatLng
              ? {
                  locationBias: {
                    center: anchorLatLng,
                    radius: 600,
                  },
                }
              : {}),
            language: 'es',
            region: 'MX',
          })
        )
      );

      for (const res of extraResults) {
        if (res.status === 'fulfilled') {
          addPlaces(res.value.places);
        }
      }

      if (anchorLatLng && typeof PlaceClass.searchNearby === 'function') {
        try {
          const nearbyRes = await PlaceClass.searchNearby({
            fields: [
              'id',
              'displayName',
              'location',
              'formattedAddress',
              'googleMapsURI',
              'primaryType',
              'types',
            ],
            locationRestriction: {
              center: anchorLatLng,
              radius: 420,
            },
            maxResultCount: 20,
            language: 'es',
          });
          addPlaces(nearbyRes.places);
        } catch {
          // Non-fatal if searchNearby returns empty or restricted
        }
      }

      onPlacesDiscovered(Object.values(collected), anchorLatLng);
      setDiscoveryStatus('ready');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('429') ||
        msg.includes('OVER_QUERY_LIMIT') ||
        msg.includes('RESOURCE_EXHAUSTED')
      ) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      setDiscoveryStatus('error');
    }
  }, [placesLib, map, onPlacesDiscovered]);

  useEffect(() => {
    if (!placesLib || !map || discoveredOnceRef.current) return;
    discoveredOnceRef.current = true;
    runCampusDiscovery();
  }, [placesLib, map, runCampusDiscovery]);

  useEffect(() => {
    if (!map || !focusTarget) return;
    map.panTo({lat: focusTarget.lat, lng: focusTarget.lng});
    if (focusTarget.zoom) {
      map.setZoom(focusTarget.zoom);
    }
  }, [map, focusTarget]);

  const handleMarkerClick = useCallback(
    (
      loc: ResolvedCampusLocation,
      marker: google.maps.marker.AdvancedMarkerElement
    ) => {
      setInfoLoc(loc);
      setInfoAnchor(marker);
      onSelectLocation(loc);
    },
    [onSelectLocation]
  );

  const handleMapClick = useCallback(
    (ev: MapMouseEvent) => {
      if (mapPickMode === 'none') return;
      const latLng = ev.detail?.latLng;
      if (!latLng) return;
      onMapPick({lat: latLng.lat, lng: latLng.lng});
    },
    [mapPickMode, onMapPick]
  );

  const handleRecenterCampus = () => {
    if (!map) return;
    if (campusBounds) {
      map.fitBounds(campusBounds);
    } else {
      runCampusDiscovery();
    }
  };

  return (
    <div className="absolute inset-0 h-full w-full">
      <GoogleMapView
        mapId="DEMO_MAP_ID"
        defaultCenter={DURANGO_FALLBACK_CENTER}
        defaultZoom={14}
        mapTypeId={mapTypeId}
        gestureHandling="greedy"
        streetViewControl={false}
        mapTypeControl={false}
        fullscreenControl={false}
        onClick={handleMapClick}
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        className={`h-full w-full ${
          mapPickMode !== 'none' ? 'cursor-crosshair' : ''
        }`}
      >
        {locations.map((loc) => (
          <CampusMarkerItem
            key={loc.id}
            loc={loc}
            isSelected={selectedLocationId === loc.id}
            onMarkerClick={handleMarkerClick}
          />
        ))}

        {infoLoc && infoAnchor && (
          <InfoWindow
            anchor={infoAnchor}
            pixelOffset={[0, -6]}
            onCloseClick={() => {
              setInfoLoc(null);
              setInfoAnchor(null);
            }}
          >
            <div className="max-w-[260px] p-1 text-slate-900">
              <div className="text-[11px] font-medium text-slate-500">
                {infoLoc.code} · {infoLoc.category}
              </div>
              <h3 className="mt-0.5 text-sm font-bold text-slate-900">
                {infoLoc.name}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                {infoLoc.description}
              </p>
              {infoLoc.spaces.length > 0 && (
                <div className="mt-1.5 text-xs font-medium text-slate-700 tabular-nums">
                  {infoLoc.spaces.length}{' '}
                  {infoLoc.spaces.length === 1
                    ? 'área registrada'
                    : 'áreas registradas'}
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onStartRouteTo(infoLoc);
                    setInfoLoc(null);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-[#6F1D3A] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#58162d]"
                >
                  <Navigation className="h-3 w-3" />
                  Ir aquí
                </button>
                {infoLoc.googleMapsURI && (
                  <a
                    href={infoLoc.googleMapsURI}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Google Maps
                  </a>
                )}
              </div>
            </div>
          </InfoWindow>
        )}

        <RouteGuideLayer
          origin={routeOrigin}
          destination={routeDestination}
          travelMode={travelMode}
          activeStepIndex={activeStepIndex}
          activeStepLocation={activeStepLocation}
          onRouteComputed={onRouteComputed}
          onRouteLoading={onRouteLoading}
          onRouteError={onRouteError}
        />
      </GoogleMapView>

      {/* Map Pick Mode Floating Instruction */}
      {mapPickMode !== 'none' && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 shadow-md">
          <MapPin className="h-4 w-4 shrink-0 text-amber-700" />
          <span className="font-medium">
            {mapPickMode === 'origin'
              ? 'Haz clic en el mapa para fijar el punto de origen'
              : mapPickMode === 'destination'
                ? 'Haz clic en el mapa para fijar el punto de destino'
                : 'Haz clic sobre el edificio en el mapa para guardar sus coordenadas'}
          </span>
          <button
            type="button"
            onClick={onCancelMapPick}
            className="rounded border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Top-Right Compact Map Controls */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
        <button
          type="button"
          onClick={() =>
            setMapTypeId((prev) => (prev === 'roadmap' ? 'hybrid' : 'roadmap'))
          }
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 whitespace-nowrap"
        >
          <Layers className="h-4 w-4 text-[#6F1D3A]" />
          {mapTypeId === 'roadmap' ? 'Vista Satélite' : 'Vista Mapa'}
        </button>

        <button
          type="button"
          onClick={handleRecenterCampus}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 whitespace-nowrap"
        >
          <Compass className="h-4 w-4 text-[#6F1D3A]" />
          {discoveryStatus === 'loading' ? 'Ubicando ITD...' : 'Centrar Campus ITD'}
        </button>
      </div>
    </div>
  );
}
