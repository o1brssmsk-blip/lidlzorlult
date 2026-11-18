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
    container.className = "fixed top-3 right-3 z-[9999] flex flex-col items-end gap-1.5 pointer-events-none";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = "transform transition-all duration-300 translate-x-8 opacity-0 flex items-center gap-2 px-3 py-1.5 rounded-full shadow-lg bg-[#2a2a2a]/95 text-white border border-[#444] pointer-events-auto";

  toast.innerHTML = `
    <svg class="w-3.5 h-3.5 text-[#EB5E28] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
    <span class="text-xs font-semibold whitespace-nowrap">${message}</span>
    ${description ? `<span class="text-[11px] text-gray-400 whitespace-nowrap max-w-[260px] truncate">${description}</span>` : ''}
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove("translate-x-8", "translate-x-12", "opacity-0");
    toast.classList.add("translate-x-0", "opacity-100");
  });

  // Remove after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove("translate-x-0", "opacity-100");
    toast.classList.add("translate-x-8", "opacity-0");
    setTimeout(() => {
      if (container && toast.parentNode === container) {
        container.removeChild(toast);
      }
    }, 300);
  }, 3500);
}
