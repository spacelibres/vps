import type { Coords, TileLayer } from "leaflet";

/**
 * Bing 底图（与 GeoClaw `viz/flight-map` 相同的做法）。
 *
 * - 无 Key：直连 Bing 瓦片 CDN `ecn.{t0..t3}.tiles.virtualearth.net/tiles/{r|a|h}{quadkey}.png`。
 * - 有 Key（`NEXT_PUBLIC_BING_MAPS_KEY`）：先取 Imagery Metadata，再按 `imageUrl` 模板拼接。
 */

export type BingImagerySet = "Road" | "Aerial" | "AerialWithLabels";

const BING_TILE_PREFIX: Record<BingImagerySet, string> = {
  Road: "r",
  Aerial: "a",
  AerialWithLabels: "h",
};

const SUBDOMAINS = ["t0", "t1", "t2", "t3"];
const ATTRIBUTION =
  '&copy; <a href="https://www.bing.com/maps">Bing Maps</a> &copy; Microsoft';

type Leaflet = typeof import("leaflet");

/** 把瓦片坐标转成 Bing quadkey。 */
export function toQuadKey(x: number, y: number, z: number): string {
  let index = "";
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit += 1;
    if ((y & mask) !== 0) digit += 2;
    index += String(digit);
  }
  return index;
}

/** 按坐标轮询子域（等价于 Leaflet 的 `_getSubdomain`）。 */
function subdomainFor(coords: Coords, subdomains: readonly string[]): string {
  return subdomains[(coords.x + coords.y) % subdomains.length]!;
}

/** 覆盖实例的 `getTileUrl`（避免 `TileLayer.extend` 的类型体操）。 */
function overrideTileUrl(layer: TileLayer, fn: (coords: Coords) => string): void {
  (layer as unknown as { getTileUrl: (coords: Coords) => string }).getTileUrl = fn;
}

/** 读取 `NEXT_PUBLIC_BING_IMAGERY_SET`（默认 `Road`）。 */
export function imagerySetFromEnv(): BingImagerySet {
  const raw = process.env.NEXT_PUBLIC_BING_IMAGERY_SET;
  return raw === "Aerial" || raw === "AerialWithLabels" || raw === "Road" ? raw : "Road";
}

/** 无 Key：直连 CDN。 */
function createDirectLayer(L: Leaflet, set: BingImagerySet): TileLayer {
  const prefix = BING_TILE_PREFIX[set];
  const layer = L.tileLayer("", {
    subdomains: SUBDOMAINS,
    maxZoom: 19,
    noWrap: false,
    attribution: ATTRIBUTION,
  });
  overrideTileUrl(
    layer,
    (coords) =>
      `https://ecn.${subdomainFor(coords, SUBDOMAINS)}.tiles.virtualearth.net/tiles/` +
      `${prefix}${toQuadKey(coords.x, coords.y, coords.z)}.png?g=14783`,
  );
  return layer;
}

interface BingMetadataResource {
  imageUrl?: string;
  imageUrlSubdomains?: string[];
  zoomMax?: number;
  zoomMin?: number;
}

/** 有 Key：走官方 Metadata。 */
async function createMetadataLayer(
  L: Leaflet,
  set: BingImagerySet,
  key: string,
): Promise<TileLayer> {
  const imagery =
    set === "Road"
      ? "RoadOnDemand"
      : set === "AerialWithLabels"
        ? "AerialWithLabelsOnDemand"
        : "Aerial";
  const url =
    `https://dev.virtualearth.net/REST/V1/Imagery/Metadata/${imagery}` +
    `?output=json&include=ImageryProviders&key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Bing Metadata HTTP ${res.status}`);
  const data = (await res.json()) as {
    resourceSets?: Array<{ resources?: BingMetadataResource[] }>;
  };
  const resource = data.resourceSets?.[0]?.resources?.[0];
  if (!resource?.imageUrl) throw new Error("Bing Metadata 无 imageUrl");

  const subdomains = resource.imageUrlSubdomains?.length
    ? resource.imageUrlSubdomains
    : SUBDOMAINS;
  const template = resource.imageUrl.replace("{subdomain}", "{s}").replace("{culture}", "zh-CN");
  const layer = L.tileLayer(template, {
    subdomains,
    maxZoom: resource.zoomMax ?? 19,
    minZoom: resource.zoomMin ?? 1,
    noWrap: false,
    attribution: ATTRIBUTION,
  });
  overrideTileUrl(layer, (coords) =>
    template
      .replace("{s}", subdomainFor(coords, subdomains))
      .replace("{quadkey}", toQuadKey(coords.x, coords.y, coords.z)),
  );
  return layer;
}

/** 创建 Bing 底图；有 Key 则优先用 Key，失败回退到直连 CDN。 */
export async function createBingTileLayer(
  L: Leaflet,
): Promise<{ layer: TileLayer; label: string }> {
  const set = imagerySetFromEnv();
  const key = process.env.NEXT_PUBLIC_BING_MAPS_KEY?.trim();
  if (key) {
    try {
      return { layer: await createMetadataLayer(L, set, key), label: `Bing · ${set}（Key）` };
    } catch {
      // 落到直连
    }
  }
  return { layer: createDirectLayer(L, set), label: `Bing · ${set}` };
}
