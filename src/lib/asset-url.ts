const LOCAL_RASTER_RE = /^\/(?!\/).*\.(png|jpe?g)(\?[^#]*)?(#.*)?$/i;

// Lokal statik gorsel yollari (.png/.jpg/.jpeg) -> .webp.
// Harici URL'lere (supabase storage, CDN) ve zaten .webp/.svg olanlara dokunmaz.
export function toWebpSrc<T>(src: T): T {
  if (typeof src !== "string") return src;
  if (!LOCAL_RASTER_RE.test(src)) return src;
  // og-image bilerek JPG kalir (sosyal crawler uyumlulugu)
  if (/og-image\.(png|jpe?g)/i.test(src)) return src;
  return src.replace(/\.(png|jpe?g)(?=\?|#|$)/i, ".webp") as T;
}

// Obje/array icindeki tum lokal gorsel yollarini webp'ye cevirir (DB'den gelen
// settings, wheel_settings, bank design_config gibi yapilar icin).
export function deepToWebp<T>(value: T): T {
  if (typeof value === "string") return toWebpSrc(value);
  if (Array.isArray(value)) return value.map((v) => deepToWebp(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // og_image_url crawler uyumu icin JPG/PNG kalabilir
      out[k] = k === "og_image_url" ? v : deepToWebp(v);
    }
    return out as T;
  }
  return value;
}

export function optimizeSupabaseImageUrl(
  source?: string | null,
  opts?: { width?: number; quality?: number; format?: "origin" | "webp" | "avif" },
) {
  if (!source) return source ?? "";

  try {
    const url = new URL(source);
    const marker = "/storage/v1/object/public/";
    const markerIndex = url.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return source;
    }

    const assetPath = url.pathname.slice(markerIndex + marker.length);
    url.pathname = `/storage/v1/render/image/public/${assetPath}`;

    if (opts?.width) {
      url.searchParams.set("width", String(Math.round(opts.width)));
    }
    if (opts?.quality) {
      url.searchParams.set("quality", String(Math.round(opts.quality)));
    }
    if (opts?.format && opts.format !== "origin") {
      url.searchParams.set("format", opts.format);
    }

    return url.toString();
  } catch {
    return source;
  }
}
