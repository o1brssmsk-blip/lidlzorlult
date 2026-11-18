export type VisitorPresencePayload = {
  sessionId?: string | null;
  routeSessionId?: string | null;
  publicId?: string | number | null;
  pathname?: string;
  online_at?: string;
  role?: string;
};

export type ParsedVisitorPresence = {
  liveVisitorCount: number;
  onlineSessionIds: Set<string>;
  sessionPaths: Record<string, string>;
  sessionLastSeenAt: Record<string, number>;
};

/** Supabase Realtime presence state → admin UI snapshot */
export function parseVisitorPresenceState(
  state: Record<string, VisitorPresencePayload[]>,
): ParsedVisitorPresence {
  let liveVisitorCount = 0;
  const onlineSessionIds = new Set<string>();
  const sessionPaths: Record<string, string> = {};
  const sessionLastSeenAt: Record<string, number> = {};
  const now = Date.now();

  for (const presences of Object.values(state)) {
    if (!presences?.length) continue;

    const visitorPresences = presences.filter(
      (p) => p.role !== "admin" && !p.pathname?.startsWith("/admin"),
    );
    if (visitorPresences.length === 0) continue;

    liveVisitorCount += 1;

    for (const p of visitorPresences) {
      // sessionId (uuid) + routeSessionId/publicId (sayisal) — hangisi varsa
      // hepsini eslestirilebilir yap; boylece ziyaretci hangi kimlikle
      // yayinlarsa yayinlasin admin satiriyla eslesir.
      const ids = [p.sessionId, p.routeSessionId, p.publicId]
        .map((v) => (v != null ? String(v).trim() : ""))
        .filter((v) => v !== "");
      if (ids.length === 0) continue;

      const ts = p.online_at ? Date.parse(p.online_at) : now;
      const seenAt = Number.isNaN(ts) ? now : ts;

      for (const id of ids) {
        onlineSessionIds.add(id);
        if (p.pathname) sessionPaths[id] = p.pathname;
        sessionLastSeenAt[id] = seenAt;
      }
    }
  }

  return {
    liveVisitorCount,
    onlineSessionIds,
    sessionPaths,
    sessionLastSeenAt,
  };
}

// Presence'dan dusen kullanicinin "online" sayilmaya devam edecegi hosgoru
// suresi: sayfa gecisleri/yenilemeler sirasinda kanal 1-3 sn kopar; bu
// boslukta admin'de titreyen "offline" gorunumunu engeller. Gercekten
// cikan kullanici en fazla bu sure kadar online gorunur.
export const PRESENCE_GRACE_MS = 60_000;

export function isSessionLive(
  sessionId: string,
  onlineSessionIds: Set<string>,
  rowStatus?: string,
  lastSeenAt?: number,
  altSessionId?: string | number | null,
  altLastSeenAt?: number,
): boolean {
  // Yalnızca Supabase Presence (Realtime) üzerinden gelen aktifliği dikkate alıyoruz.
  // DB'de "online" kalmış ancak Presence'da olmayan kullanıcılar "offline" sayılır.
  if (onlineSessionIds.has(sessionId)) return true;
  // Satirin alternatif kimligi (public_id) ile de eslestir: bazi sayfalarda
  // ziyaretci presence'i sayisal id ile yayinlayabilir.
  if (altSessionId != null) {
    const alt = String(altSessionId).trim();
    if (alt !== "" && onlineSessionIds.has(alt)) return true;
  }
  // Hosgoru penceresi: presence'dan yeni dustu (sayfa gecisi / reload /
  // websocket kopmasi) ama az once gorulduyse hala online say.
  const seen = Math.max(lastSeenAt ?? 0, altLastSeenAt ?? 0);
  if (seen > 0 && Date.now() - seen < PRESENCE_GRACE_MS) return true;
  return false;
}
