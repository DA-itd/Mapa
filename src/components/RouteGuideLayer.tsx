import {useEffect, useRef} from 'react';
import {
  AdvancedMarker,
  AdvancedMarkerAnchorPoint,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import type {
  ComputedRouteResult,
  RouteStepInfo,
  TravelModeOption,
} from '../types/campus';

interface RouteGuideLayerProps {
  origin: {lat: number; lng: number} | null;
  destination: {lat: number; lng: number} | null;
  travelMode: TravelModeOption;
  activeStepIndex: number;
  activeStepLocation: {lat: number; lng: number} | null;
  onRouteComputed: (route: ComputedRouteResult | null) => void;
  onRouteLoading: (loading: boolean) => void;
  onRouteError: (error: string | null) => void;
}

function extractLatLng(loc: unknown): {lat: number; lng: number} | null {
  if (!loc || typeof loc !== 'object') return null;
  const candidate = loc as Record<string, unknown>;

  if (typeof candidate.lat === 'function' && typeof candidate.lng === 'function') {
    return {
      lat: (candidate.lat as () => number)(),
      lng: (candidate.lng as () => number)(),
    };
  }
  if (typeof candidate.lat === 'number' && typeof candidate.lng === 'number') {
    return {lat: candidate.lat, lng: candidate.lng};
  }
  if (candidate.latLng && typeof candidate.latLng === 'object') {
    const inner = candidate.latLng as Record<string, unknown>;
    if (
      typeof inner.latitude === 'number' &&
      typeof inner.longitude === 'number'
    ) {
      return {lat: inner.latitude, lng: inner.longitude};
    }
  }
  if (
    typeof candidate.latitude === 'number' &&
    typeof candidate.longitude === 'number'
  ) {
    return {lat: candidate.latitude, lng: candidate.longitude};
  }
  return null;
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(millis: number): string {
  const mins = Math.max(1, Math.round(millis / 60000));
  if (mins < 60) {
    return `${mins} min`;
  }
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs} h ${rem} min`;
}

export function RouteGuideLayer({
  origin,
  destination,
  travelMode,
  activeStepIndex,
  activeStepLocation,
  onRouteComputed,
  onRouteLoading,
  onRouteError,
}: RouteGuideLayerProps) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!routesLib || !map || !origin || !destination) {
      onRouteComputed(null);
      onRouteError(null);
      return;
    }

    let cancelled = false;
    onRouteLoading(true);
    onRouteError(null);

    const request = {
      origin,
      destination,
      travelMode,
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
      language: 'es',
    };

    const RouteClass = routesLib.Route as unknown as {
      computeRoutes: (req: unknown) => Promise<{routes?: unknown[]}>;
    };

    RouteClass.computeRoutes(request)
      .then((response) => {
        if (cancelled) return;
        onRouteLoading(false);

        const primaryRoute = response.routes?.[0] as
          | {
              createPolylines?: () => google.maps.Polyline[];
              viewport?: google.maps.LatLngBounds;
              distanceMeters?: number;
              durationMillis?: number;
              legs?: Array<{
                distanceMeters?: number;
                durationMillis?: number;
                steps?: Array<{
                  instructions?: string;
                  navigationInstruction?: {
                    instructions?: string;
                    maneuver?: string;
                  };
                  maneuver?: string;
                  distanceMeters?: number;
                  durationMillis?: number;
                  localizedValues?: {
                    distance?: {text?: string};
                    staticDuration?: {text?: string};
                  };
                  startLocation?: unknown;
                  endLocation?: unknown;
                }>;
              }>;
            }
          | undefined;

        if (!primaryRoute) {
          onRouteComputed(null);
          onRouteError('No se encontró una ruta disponible entre estos dos puntos.');
          return;
        }

        if (typeof primaryRoute.createPolylines === 'function') {
          const newPolylines = primaryRoute.createPolylines();
          newPolylines.forEach((polyline) => {
            polyline.setOptions({
              strokeColor: '#6F1D3A',
              strokeOpacity: 0.92,
              strokeWeight: 6,
            });
            polyline.setMap(map);
          });
          polylinesRef.current = newPolylines;
        }

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport, {
            top: 64,
            right: 48,
            bottom: 64,
            left: 48,
          });
        }

        const firstLeg = primaryRoute.legs?.[0];
        const rawSteps = firstLeg?.steps ?? [];
        const parsedSteps: RouteStepInfo[] = rawSteps.map((step, idx) => {
          const instruction =
            step.instructions ||
            step.navigationInstruction?.instructions ||
            `Continúa por el tramo ${idx + 1}`;
          const maneuver =
            step.navigationInstruction?.maneuver || step.maneuver || 'STRAIGHT';
          const stepMeters = step.distanceMeters ?? 0;
          const stepMillis = step.durationMillis ?? 0;

          return {
            index: idx,
            instruction,
            maneuver,
            distanceMeters: stepMeters,
            distanceText:
              step.localizedValues?.distance?.text || formatDistance(stepMeters),
            durationText:
              step.localizedValues?.staticDuration?.text ||
              formatDuration(stepMillis),
            startLocation: extractLatLng(step.startLocation),
            endLocation: extractLatLng(step.endLocation),
          };
        });

        const totalMeters =
          primaryRoute.distanceMeters ?? firstLeg?.distanceMeters ?? 0;
        const totalMillis =
          primaryRoute.durationMillis ?? firstLeg?.durationMillis ?? 0;

        onRouteComputed({
          distanceMeters: totalMeters,
          durationMillis: totalMillis,
          distanceText: formatDistance(totalMeters),
          durationText: formatDuration(totalMillis),
          steps: parsedSteps,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        onRouteLoading(false);
        const message =
          err instanceof Error ? err.message : 'No fue posible calcular la ruta.';
        if (
          message.includes('429') ||
          message.includes('OVER_QUERY_LIMIT') ||
          message.includes('RESOURCE_EXHAUSTED') ||
          message.includes('Quota')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRouteComputed(null);
        onRouteError(
          'No se pudo cargar la ruta en este momento. Verifica tu conexión o intenta con otro punto.'
        );
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [
    routesLib,
    map,
    origin,
    destination,
    travelMode,
    onRouteComputed,
    onRouteLoading,
    onRouteError,
  ]);

  return (
    <>
      {origin && (
        <AdvancedMarker
          position={origin}
          zIndex={1200}
          anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          title="Origen de la ruta"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-700 text-xs font-bold text-white shadow-md">
            A
          </div>
        </AdvancedMarker>
      )}

      {destination && (
        <AdvancedMarker
          position={destination}
          zIndex={1200}
          anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          title="Destino de la ruta"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#6F1D3A] text-xs font-bold text-white shadow-md">
            B
          </div>
        </AdvancedMarker>
      )}

      {activeStepLocation && (
        <AdvancedMarker
          position={activeStepLocation}
          zIndex={1300}
          anchorPoint={AdvancedMarkerAnchorPoint.CENTER}
          title={`Paso ${activeStepIndex + 1}`}
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-amber-600 text-xs font-bold text-white shadow-lg">
            {activeStepIndex + 1}
          </div>
        </AdvancedMarker>
      )}
    </>
  );
}
