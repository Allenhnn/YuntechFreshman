/**
 * Street View reference panel for the facade tool. Display only: the official Maps JavaScript API
 * renders the panorama live, and nothing is downloaded, cached or sampled from it (Google Maps
 * Platform terms forbid storing imagery or building content from it). You read colours, window
 * patterns and proportions off it by eye and enter them in the style panel.
 *
 * Key: VITE_GOOGLE_MAPS_KEY in .env.local (gitignored). Use a browser key restricted to the
 * Maps JavaScript API and the http://localhost:* referrer.
 */

/** The small part of google.maps this panel uses (avoids a @types dependency). */
interface LatLngLiteral { lat: number; lng: number }
interface LatLng { lat(): number; lng(): number }
interface PanoData { location?: { latLng?: LatLng; pano?: string }; imageDate?: string }
interface Panorama {
  setPano(id: string): void;
  setPov(pov: { heading: number; pitch: number }): void;
  setVisible(v: boolean): void;
}
interface MapsApi {
  StreetViewPanorama: new (el: HTMLElement, opts: Record<string, unknown>) => Panorama;
  StreetViewService: new () => {
    getPanorama(req: { location: LatLngLiteral; radius: number; preference: string; source: string }): Promise<{ data: PanoData }>;
  };
  StreetViewPreference: { NEAREST: string };
  StreetViewSource: { OUTDOOR: string };
}

declare global {
  interface Window { google?: { maps: MapsApi }; __facadeMapsReady?: () => void }
}

let loading: Promise<MapsApi> | null = null;

function loadMaps(key: string): Promise<MapsApi> {
  loading ??= new Promise((resolve, reject) => {
    window.__facadeMapsReady = () => (window.google ? resolve(window.google.maps) : reject(new Error('Maps API did not load')));
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=__facadeMapsReady`;
    s.async = true;
    s.onerror = () => reject(new Error('Could not load the Maps JavaScript API (network or key restriction)'));
    document.head.append(s);
  });
  return loading;
}

export interface StreetViewPanel {
  /** Looks at a wall: finds the nearest outdoor panorama in front of it and turns toward the wall. */
  show(target: LatLngLiteral, standAt: LatLngLiteral): Promise<string>;
}

export function createStreetViewPanel(el: HTMLElement, key: string | undefined): StreetViewPanel {
  let pano: Panorama | null = null;
  return {
    async show(target, standAt) {
      if (!key) {
        el.innerHTML = `<div class="sv-msg">No Maps key. Add <code>VITE_GOOGLE_MAPS_KEY=…</code> to <code>.env.local</code>
          (a browser key limited to the Maps JavaScript API and <code>http://localhost:*</code>), then restart <code>npm run dev</code>.</div>`;
        return 'Street View: no key configured';
      }
      const maps = await loadMaps(key);
      const { data } = await new maps.StreetViewService().getPanorama({
        location: standAt, radius: 60, preference: maps.StreetViewPreference.NEAREST, source: maps.StreetViewSource.OUTDOOR,
      });
      const at = data.location?.latLng;
      if (!at || !data.location?.pano) return 'Street View: no panorama within 60 m of this wall';
      // Initial heading from the panorama toward the wall's midpoint.
      const dLon = ((target.lng - at.lng()) * Math.PI) / 180;
      const lat1 = (at.lat() * Math.PI) / 180, lat2 = (target.lat * Math.PI) / 180;
      const heading = (Math.atan2(Math.sin(dLon) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)) * 180) / Math.PI;
      pano ??= new maps.StreetViewPanorama(el, { addressControl: false, fullscreenControl: false, motionTracking: false, showRoadLabels: false });
      pano.setPano(data.location.pano);
      pano.setPov({ heading: (heading + 360) % 360, pitch: 12 });
      pano.setVisible(true);
      const dist = Math.hypot((target.lat - at.lat()) * 111320, (target.lng - at.lng()) * 111320 * Math.cos(lat1));
      return `Street View: panorama ${dist.toFixed(0)} m from the wall${data.imageDate ? `, captured ${data.imageDate}` : ''}`;
    },
  };
}
