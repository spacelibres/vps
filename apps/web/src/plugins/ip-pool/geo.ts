/** 纯地理工具（客户端安全：不含任何 node/fs 依赖）。 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** 解析 "lat,lng"。 */
export function parseLocString(loc: string | undefined): GeoPoint | null {
  if (!loc) return null;
  const [latRaw, lngRaw] = loc.split(",");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
