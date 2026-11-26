"use client";

import { useRef, useState } from "react";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { useWorkspace } from "../workspace/use-workspace";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";

type EventKind = "INTERNAL_NOTE" | "CUSTOMER_CONTACTED" | "PROVIDER_CONTACTED"
  | "ESCALATED" | "ESCALATION_REVIEWED";
interface FollowupEvent {
  eventId: string;
  refundId: string;
  actorUserId: string;
  actorDisplayName: string;
  eventKind: EventKind;
  evidenceReference: string | null;
  note: string;
  recordedAt: string;
}
interface FollowupHistory {
  refundId: string;
  events: FollowupEvent[];
  hasMore: boolean;
}
const ACTIONS: { value: EventKind; label: string }[] = [
  { value: "INTERNAL_NOTE", label: "Internal follow-up note" },
  { value: "CUSTOMER_CONTACTED", label: "Customer contacted" },
  { value: "PROVIDER_CONTACTED", label: "Payment provider contacted" },
  { value: "ESCALATED", label: "Escalate for urgent review" },
  { value: "ESCALATION_REVIEWED", label: "Escalation reviewed (not paid)" },
];
const PAGE = 20;

export function RefundFollowupPanel({
  refundId, onRecorded,
}: { refundId: string; onRecorded: () => void }) {
  const { session, queue } = useWorkspace();
  const [kind, setKind] = useState<EventKind>("INTERNAL_NOTE");
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [offset, setOffset] = useState(0);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Keep the same ID if a response is lost; a changed draft gets a new ID.
  const pendingRequestId = useRef<string | null>(null);
  const path = session
    ? `/v1/refunds/followups?businessId=${encodeURIComponent(session.businessId)}&branchId=${encodeURIComponent(session.branchId)}&refundId=${encodeURIComponent(refundId)}&limit=${PAGE}&offset=${offset}`
    : null;
  const { data, loading, error, refetch } = useApiFetch<FollowupHistory>(path);
  const idBase = `refund-followup-${refundId}`;
  const timeline = data?.refundId === refundId && Array.isArray(data.events)
    ? data : null;

  function clearAttempt() {
    pendingRequestId.current = null;
    setErrorMessage(null);
    setSuccessMessage(null);
  }
  async function recordFollowup() {
    if (!session || !queue.online || saving ||
        note.trim().length < 20 || note.trim().length > 700) return;
    const businessId = session.businessId;
    const branchId = session.branchId;
    const clientRequestId = pendingRequestId.current ?? crypto.randomUUID();
    pendingRequestId.current = clientRequestId;
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch("/v1/refunds/followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          businessId, branchId, refundId, clientRequestId, eventKind: kind,
          note: note.trim(), evidenceReference: reference.trim() || null,
        }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const result = await response.json() as { event?: { refundId?: string } };
      if (result.event?.refundId !== refundId) throw new Error(
        "Refund follow-up could not be verified. Refresh the timeline before retrying.");
      pendingRequestId.current = null;
      setKind("INTERNAL_NOTE");
      setNote("");
      setReference("");
      setSuccessMessage("Follow-up recorded in the audit history. Payout status remains unchanged.");
      if (offset !== 0) setOffset(0);
      else refetch();
      onRecorded();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Follow-up could not be saved.");
    } finally { setSaving(false); }
  }
  return (
    <section aria-label="Refund follow-up history" className="tos-card tos-card--padded"
      style={{ marginTop: 12 }}>
      <h3 className="tos-section__title">Follow-up and escalation history</h3>
      <p className="tos-section__sub">
        Notes are permanent and attributed to the staff account. Escalating or reviewing a case
        does not mean it has been refunded; only verified payment evidence can establish that.
      </p>
      <div className="tos-filter-row" style={{ marginTop: 10, marginBottom: 10 }}>
        <label htmlFor={idBase + "-kind"}>Action</label>
        <select id={idBase + "-kind"} className="tos-input" value={kind}
          disabled={saving} onChange={(event) => {
            setKind(event.target.value as EventKind); clearAttempt();
          }}>
          {ACTIONS.map((action) => <option value={action.value} key={action.value}>
            {action.label}
          </option>)}
        </select>
      </div>
      <label htmlFor={idBase + "-note"}>What happened? (20–700 characters)</label>
      <textarea id={idBase + "-note"} className="tos-input" rows={3} maxLength={700}
        style={{ display: "block", width: "100%", marginTop: 5, marginBottom: 10 }}
        placeholder="Record the action, customer response, or investigation outcome."
        disabled={saving} value={note} onChange={(event) => {
          setNote(event.target.value); clearAttempt();
        }} />
      <label htmlFor={idBase + "-reference"}>Provider support reference (optional)</label>
      <input id={idBase + "-reference"} className="tos-input" maxLength={160}
        style={{ display: "block", width: "100%", marginTop: 5, marginBottom: 10 }}
        placeholder="External support case number, never a password or URL"
        disabled={saving} value={reference} onChange={(event) => {
          setReference(event.target.value); clearAttempt();
        }} />
      <div className="tos-row" style={{ gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="primary" loading={saving}
          disabled={!queue.online || note.trim().length < 20 || note.trim().length > 700}
          onClick={() => void recordFollowup()}>Record follow-up</Button>
        <Button size="sm" variant="outline" onClick={refetch}>Refresh history</Button>
        {!queue.online ? <span className="tos-section__sub" role="status">
          Connect to the internet to record audited follow-ups.
        </span> : null}
      </div>
      {errorMessage ? <p role="alert" className="tos-section__sub">{errorMessage}</p> : null}
      {successMessage ? <p role="status" className="tos-section__sub">{successMessage}</p> : null}
      <div style={{ marginTop: 14 }}>
        <strong>Recorded actions</strong>
        {loading ? <p className="tos-section__sub">Loading follow-up history…</p> : null}
        {error ? <StatePanel inline variant="error" title="Could not load follow-ups"
          text={error} actionLabel="Retry" onAction={refetch} /> : null}
        {!loading && !error && timeline?.events.length === 0 ?
          <p className="tos-section__sub">No follow-up actions recorded yet.</p> : null}
        {!loading && !error && timeline?.events.length ? (
          <ol className="tos-list-cards" aria-label="Audited refund follow-up timeline">
            {timeline.events.map((event) => (
              <li key={event.eventId} className="tos-returnable-card">
                <strong>{ACTIONS.find((action) => action.value === event.eventKind)?.label
                  ?? "Follow-up"}</strong>
                <span className="tos-returnable-card__sub">
                  {new Date(event.recordedAt).toLocaleString()} · {event.actorDisplayName}
                </span>
                <p style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{event.note}</p>
                {event.evidenceReference ? <span className="tos-returnable-card__sub">
                  Support ref: {event.evidenceReference}
                </span> : null}
              </li>
            ))}
          </ol>
        ) : null}
        {timeline && (offset > 0 || timeline.hasMore) ? (
          <div className="tos-row" style={{ justifyContent: "space-between", gap: 8 }}>
            <Button size="sm" variant="outline" disabled={offset === 0 || loading}
              onClick={() => setOffset((n) => Math.max(0, n - PAGE))}>Previous</Button>
            <span className="tos-section__sub">Page {Math.floor(offset / PAGE) + 1}</span>
            <Button size="sm" variant="outline" disabled={!timeline.hasMore || loading}
              onClick={() => setOffset((n) => n + PAGE)}>Next</Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
