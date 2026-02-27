"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) {
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
      }
    } catch {
      // Silently ignore fetch errors
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function markRead(notificationId: string) {
    await fetch(`/api/notifications/${notificationId}/read`, { method: "POST" }).catch(() => {});
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
  }

  async function markAllRead() {
    await fetch("/api/notifications/read-all", { method: "POST" }).catch(() => {});
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount(0);
  }

  function formatRelative(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-1.5 hover:bg-[color:var(--accent-soft)]"
        aria-label="Notifications"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-5 w-5"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
          />
        </svg>
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadCount > 0 ? (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-[color:var(--accent)] hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-[color:var(--muted)]">
                No notifications
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`border-b border-[color:var(--border)] px-4 py-3 last:border-b-0 ${
                    n.readAt ? "" : "bg-[color:var(--accent-soft)]"
                  }`}
                >
                  {n.linkUrl ? (
                    <a
                      href={n.linkUrl}
                      onClick={() => {
                        if (!n.readAt) markRead(n.id);
                        setOpen(false);
                      }}
                      className="block"
                    >
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.body ? <p className="mt-0.5 text-xs text-[color:var(--muted)]">{n.body}</p> : null}
                      <p className="mt-1 text-[10px] text-[color:var(--muted)]">{formatRelative(n.createdAt)}</p>
                    </a>
                  ) : (
                    <div
                      onClick={() => {
                        if (!n.readAt) markRead(n.id);
                      }}
                      className="cursor-pointer"
                    >
                      <p className="text-sm font-medium">{n.title}</p>
                      {n.body ? <p className="mt-0.5 text-xs text-[color:var(--muted)]">{n.body}</p> : null}
                      <p className="mt-1 text-[10px] text-[color:var(--muted)]">{formatRelative(n.createdAt)}</p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
