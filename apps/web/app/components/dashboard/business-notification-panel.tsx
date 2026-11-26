"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { BusinessNotificationItem, BusinessNotificationsResponse } from "@tradeos/contracts";
import { useWorkspace } from "../workspace/use-workspace";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import styles from "./business-notification-panel.module.css";

const ROLES = new Set(["OWNER","ADMIN","MANAGER","ACCOUNTANT"]);
const LEVELS = ["CRITICAL","HIGH","MEDIUM","LOW","INFO"];

export function BusinessNotificationPanel() {
  const { session, role, queue } = useWorkspace();
  const [working, setWorking] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const identity = session ? session.businessId + ":" + session.branchId + ":" + session.staffId : "";
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const allowed = role !== null && ROLES.has(role);
  const params = session && allowed && queue.online
    ? "businessId=" + encodeURIComponent(session.businessId) +
      "&branchId=" + encodeURIComponent(session.branchId)
    : null;
  const { data, loading, error, refetch } = useApiFetch<BusinessNotificationsResponse>(
    params ? "/v1/intelligence/notifications?" + params : null,
  );
  if (!allowed || !session) return null;
  const valid = data && !loading && !error && queue.online &&
    data.businessId === session.businessId && data.branchId === session.branchId;
  const inbox = valid ? data : null;
  const items = inbox?.notifications.slice(0, expanded ? 100 : 8) ?? [];

  async function markRead(item: BusinessNotificationItem) {
    if (!queue.online || !params || working) return;
    const before = identity;
    setWorking(item.kind + ":" + item.id);
    setNoticeError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        "/v1/intelligence/notifications/" + item.kind +
        "/" + encodeURIComponent(item.id) + "/read?" + params,
        { method: "POST" },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      if (identityRef.current === before) refetch();
    } catch (err) {
      if (identityRef.current === before) {
        setNoticeError(err instanceof Error ? err.message : "Could not mark notification as read.");
        refetch();
      }
    } finally {
      setWorking(null);
    }
  }
  return (
    <section className={styles.panel} aria-label="Business notifications">
      <details>
        <summary className={styles.summary}>
          <span className={styles.title}>Notifications</span>
          <span className={styles.count}>
            {queue.online && inbox
              ? inbox.unreadCount.toLocaleString("en-GH") + " unread"
              : "Online updates"}
          </span>
        </summary>
        <div className={styles.body}>
          <p className={styles.intro}>
            Your business alerts and owner approval requests. Read confirmations are private to your account.
          </p>
          {!queue.online ? (
            <p className={styles.notice} role="status">
              Connect to load current notifications. Offline sales are unaffected.
            </p>
          ) : loading ? (
            <p className={styles.notice} role="status">Loading notifications…</p>
          ) : error ? (
            <p className={styles.notice} role="alert">Could not load notifications: {error}</p>
          ) : inbox === null ? (
            <p className={styles.notice}>Notifications are unavailable for this branch.</p>
          ) : inbox.notifications.length === 0 ? (
            <p className={styles.notice}>No active notifications at the moment.</p>
          ) : (
            <>
              {noticeError ? <p role="alert" className={styles.notice}>{noticeError}</p> : null}
              <ul className={styles.list}>
                {items.map((item) => (
                  <li key={item.kind + ":" + item.id} className={styles.item}>
                    <div className={styles.itemBody}>
                      <div className={styles.itemHeading}>
                        <span className={styles.severity}>{LEVELS.includes(item.severity) ? item.severity : "INFO"}</span>
                        <strong>{item.title}</strong>
                        {!item.readAt ? <span className={styles.unread}>Unread</span> : null}
                      </div>
                      <p>{item.summary}</p>
                      <small>{new Date(item.occurredAt).toLocaleString("en-GH",
                        { dateStyle:"medium", timeStyle:"short" })}</small>
                    </div>
                    <div className={styles.actions}>
                      <Link href={item.href} className={styles.open}>Review</Link>
                      {!item.readAt ? (
                        <button type="button" disabled={working !== null || !queue.online}
                          onClick={() => { void markRead(item); }}>
                          {working === item.kind + ":" + item.id ? "Saving…" : "Mark read"}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
              {inbox.notifications.length > 8 ? (
                <button type="button" className={styles.more}
                  onClick={() => setExpanded((wasExpanded) => !wasExpanded)}
                  aria-expanded={expanded}>
                  {expanded ? "Show fewer notifications" : "Show all loaded notifications"}
                </button>
              ) : null}
              {inbox.truncated ? (
                <p className={styles.notice}>
                  Showing the first 100 priority notifications. The full history is not included.
                </p>
              ) : null}
            </>
          )}
        </div>
      </details>
    </section>
  );
}
