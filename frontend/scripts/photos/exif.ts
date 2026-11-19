/**
 * Minimal EXIF reader for photo ingest: GPS position, compass heading, capture time and focal
 * length from a JPEG's APP1 segment (TIFF IFDs). No dependency, read-only, ignores everything else.
 */
export interface PhotoExif {
  lat?: number;
  lon?: number;
  /** Compass direction the camera was pointing (degrees from north, clockwise). */
  heading?: number;
  /** 35 mm-equivalent focal length (mm). */
  focal35?: number;
  time?: string;
  width?: number;
  height?: number;
}

const TAG = {
  exifIfd: 0x8769, gpsIfd: 0x8825, dateTime: 0x9003, focal35: 0xa405, pixelX: 0xa002, pixelY: 0xa003,
  latRef: 1, lat: 2, lonRef: 3, lon: 4, imgDirection: 17,
} as const;

/** Returns the TIFF block inside the JPEG's Exif APP1 segment, or null. */
function tiffBlock(buf: Uint8Array): DataView | null {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint16(0) !== 0xffd8) return null;
  let o = 2;
  while (o + 4 < v.byteLength) {
    const marker = v.getUint16(o);
    const len = v.getUint16(o + 2);
    if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966 /* "Exif" */) {
      return new DataView(buf.buffer, buf.byteOffset + o + 10, len - 8);
    }
    if (marker === 0xffda) break; // start of scan: no more metadata
    o += 2 + len;
  }
  return null;
}

export function readExif(buf: Uint8Array): PhotoExif {
  const t = tiffBlock(buf);
  if (!t) return {};
  const le = t.getUint16(0) === 0x4949;
  const u16 = (o: number): number => t.getUint16(o, le);
  const u32 = (o: number): number => t.getUint32(o, le);
  const rational = (o: number): number => u32(o) / (u32(o + 4) || 1);

  /** Tag → [type, count, value offset (or inline position)]. */
  const ifd = (start: number): Map<number, [number, number, number]> => {
    const out = new Map<number, [number, number, number]>();
    if (start <= 0 || start + 2 > t.byteLength) return out;
    const n = u16(start);
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12;
      if (e + 12 > t.byteLength) break;
      const type = u16(e + 2), count = u32(e + 4);
      const size = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[type] ?? 1;
      out.set(u16(e), [type, count, size * count > 4 ? u32(e + 8) : e + 8]);
    }
    return out;
  };
  const num = (m: Map<number, [number, number, number]>, tag: number): number | undefined => {
    const e = m.get(tag);
    if (!e) return undefined;
    const [type, , at] = e;
    return type === 3 ? u16(at) : type === 4 ? u32(at) : type === 5 ? rational(at) : undefined;
  };
  const str = (m: Map<number, [number, number, number]>, tag: number): string | undefined => {
    const e = m.get(tag);
    if (!e) return undefined;
    let s = '';
    for (let i = 0; i < e[1] && e[2] + i < t.byteLength; i++) {
      const c = t.getUint8(e[2] + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const dms = (m: Map<number, [number, number, number]>, tag: number): number | undefined => {
    const e = m.get(tag);
    if (!e || e[1] < 3) return undefined;
    return rational(e[2]) + rational(e[2] + 8) / 60 + rational(e[2] + 16) / 3600;
  };

  const ifd0 = ifd(u32(4));
  const exif = ifd(num(ifd0, TAG.exifIfd) ?? 0);
  const gps = ifd(num(ifd0, TAG.gpsIfd) ?? 0);
  const out: PhotoExif = {
    heading: num(gps, TAG.imgDirection),
    focal35: num(exif, TAG.focal35),
    time: str(exif, TAG.dateTime),
    width: num(exif, TAG.pixelX),
    height: num(exif, TAG.pixelY),
  };
  const lat = dms(gps, TAG.lat), lon = dms(gps, TAG.lon);
  if (lat !== undefined && lon !== undefined) {
    out.lat = str(gps, TAG.latRef) === 'S' ? -lat : lat;
    out.lon = str(gps, TAG.lonRef) === 'W' ? -lon : lon;
  }
  return out;
}
