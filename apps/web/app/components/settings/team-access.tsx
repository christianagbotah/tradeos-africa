"use client";
import { useActionFeedbackState } from "../ui/action-feedback";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BusinessRole, StaffDirectoryItem } from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { readApiErrorMessage } from "../../../lib/auth-fetch";
import { Button } from "../ui/button";
import { IconEdit, IconPlus, IconRefresh, IconUsers } from "../ui/icons";
import { useWorkspace } from "../workspace/use-workspace";
import { StaffEditor, type StaffEditorValue } from "./staff-editor";

const ADMIN_MANAGEABLE_ROLES: readonly BusinessRole[] = ["MANAGER", "CASHIER", "POS_ATTENDANT", "SALES", "INVENTORY", "ACCOUNTANT", "STAFF", "VIEWER"];

type TeamEditorMode = { kind: "view" } | { kind: "create" } | { kind: "edit"; staffId: string };
type TeamFeedback = { tone: "success" | "error" | "info"; text: string } | null;
type OneTimeInvite = { staffId: string; staffName: string; link: string; expiresAt: string } | null;

export function canReadTeam(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MANAGER";
}

export function canMutateTeam(role: string | null | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canManageStaffRole(actorRole: string | null | undefined, targetRole: BusinessRole): boolean {
  if (actorRole === "OWNER") return true;
  return actorRole === "ADMIN" && ADMIN_MANAGEABLE_ROLES.includes(targetRole);
}

export function TeamAccess({ online }: { online: boolean }) {
  const { session, role, businessContext } = useWorkspace();
  const businessId = session?.businessId ?? null;
  const readable = canReadTeam(role);
  const mutable = canMutateTeam(role);
  const [staff, setStaff] = useState<StaffDirectoryItem[]>([]);
  const [mode, setMode] = useState<TeamEditorMode>({ kind: "view" });
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TeamFeedback>(null);
  useActionFeedbackState(feedback ? { tone: feedback.tone, message: feedback.text } : null);
  const [oneTimeInvite, setOneTimeInvite] = useState<OneTimeInvite>(null);
  const [branchEditor, setBranchEditor] = useState<{
    staffId:string; selected:string[]; loading:boolean
  } | null>(null);

  const editingStaff = useMemo(
    () => mode.kind === "edit" ? staff.find((member) => member.id === mode.staffId) ?? null : null,
    [mode, staff],
  );

  const loadTeam = useCallback(async () => {
    if (!businessId || !readable || !online) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(`/v1/staff?businessId=${encodeURIComponent(businessId)}`);
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Team directory could not be loaded"));
      const payload = await response.json() as { staff?: StaffDirectoryItem[] };
      setStaff(payload.staff ?? []);
    } catch (error) {
      setLoadError(errorMessage(error, "Team directory could not be loaded"));
    } finally {
      setLoading(false);
    }
  }, [businessId, online, readable]);

  useEffect(() => {
    setMode({ kind: "view" });
    setOneTimeInvite(null);
    setBranchEditor(null);
    setFeedback(null);
    setStaff([]);
    if (readable && online) void loadTeam();
  }, [businessId, online, readable, loadTeam]);

  const saveStaff = async (value: StaffEditorValue) => {
    if (!businessId || !online || !mutable || busyId) return;
    const editing = mode.kind === "edit" ? staff.find((member) => member.id === mode.staffId) ?? null : null;
    const targetRole = editing?.role ?? value.role;
    if (editing && !canManageStaffRole(role, targetRole)) return;
    if (role === "ADMIN" && !ADMIN_MANAGEABLE_ROLES.includes(value.role)) return;

    setBusyId(editing?.id ?? "create");
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        editing ? `/v1/staff/${encodeURIComponent(editing.id)}` : "/v1/staff",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            businessId,
            displayName: value.displayName,
            email: value.email || null,
            phone: value.phone || null,
            role: value.role,
          }),
        },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response, editing ? "Staff member could not be updated" : "Staff member could not be created"));
      const saved=await response.json() as {staff?:StaffDirectoryItem};
      setMode({ kind: "view" });
      await loadTeam();
      if(value.role==="POS_ATTENDANT" && (!editing || editing.role!=="POS_ATTENDANT")
        && saved.staff?.id){
        setBranchEditor({staffId:saved.staff.id,selected:[],loading:false});
        setFeedback({tone:"info",text:"Staff saved. Select allowed branches below and save access before inviting this POS attendant."});
      }else{
        setFeedback({ tone: "success", text: editing ? "Staff details updated." : "Staff member added." });
      }
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error, "Staff change failed") });
    } finally {
      setBusyId(null);
    }
  };

  const invite = async (member: StaffDirectoryItem) => {
    if (!businessId || !online || busyId || !canManageStaffRole(role, member.role)) return;
    setBusyId(`invite:${member.id}`);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(`/v1/staff/${encodeURIComponent(member.id)}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response, "Invitation could not be created"));
      const payload = await response.json() as { acceptanceToken?: string; invitation?: { expiresAt?: string } };
      if (!payload.acceptanceToken || !payload.invitation?.expiresAt) throw new Error("Server returned an incomplete invitation.");
      const link = `${window.location.origin}/invite/team#token=${encodeURIComponent(payload.acceptanceToken)}`;
      setOneTimeInvite({ staffId: member.id, staffName: member.displayName, link, expiresAt: payload.invitation.expiresAt });
      await loadTeam();
      setFeedback({ tone: "success", text: `Invitation created for ${member.displayName}. Copy the one-time link now.` });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error, "Invitation could not be created") });
    } finally {
      setBusyId(null);
    }
  };

  const setActive = async (member: StaffDirectoryItem, active: boolean) => {
    if (!businessId || !online || busyId || !canManageStaffRole(role, member.role)) return;
    setBusyId(`${active ? "reactivate" : "suspend"}:${member.id}`);
    setFeedback(null);
    try {
      const response = await getOfflineQueue().authenticatedFetch(
        `/v1/staff/${encodeURIComponent(member.id)}/${active ? "reactivate" : "suspend"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId }),
        },
      );
      if (!response.ok) throw new Error(await readApiErrorMessage(response, active ? "Staff member could not be reactivated" : "Staff member could not be suspended"));
      if (mode.kind === "edit" && mode.staffId === member.id) setMode({ kind: "view" });
      await loadTeam();
      setFeedback({ tone: "success", text: `${member.displayName} ${active ? "reactivated" : "suspended"}.` });
    } catch (error) {
      setFeedback({ tone: "error", text: errorMessage(error, active ? "Staff member could not be reactivated" : "Staff member could not be suspended") });
    } finally {
      setBusyId(null);
    }
  };

  const openBranchAssignments = async (member:StaffDirectoryItem) => {
    if(!businessId||!online||busyId||member.role!=="POS_ATTENDANT"||
      !canManageStaffRole(role,member.role))return;
    if(branchEditor?.staffId===member.id){setBranchEditor(null);return;}
    setBranchEditor({staffId:member.id,selected:[],loading:true});
    setFeedback(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        `/v1/staff/${encodeURIComponent(member.id)}/branches?businessId=${encodeURIComponent(businessId)}`,
        {cache:"no-store"},
      );
      if(!response.ok)throw new Error(await readApiErrorMessage(response,"Branch assignments could not be loaded"));
      const result=await response.json() as {branchIds:string[]};
      setBranchEditor({staffId:member.id,selected:result.branchIds,loading:false});
    }catch(error){
      setBranchEditor(null);
      setFeedback({tone:"error",text:errorMessage(error,"Cannot load POS branch assignments")});
    }
  };
  const saveBranchAssignments = async () => {
    if(!branchEditor||branchEditor.loading||!businessId||!online||busyId)return;
    setBusyId("branches:"+branchEditor.staffId);
    setFeedback(null);
    try{
      const response=await getOfflineQueue().authenticatedFetch(
        `/v1/staff/${encodeURIComponent(branchEditor.staffId)}/branches`,
        {method:"PUT",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({businessId,branchIds:branchEditor.selected})},
      );
      if(!response.ok)throw new Error(await readApiErrorMessage(response,"Branch assignment failed"));
      const result=await response.json() as {branchIds:string[]};
      setBranchEditor(null);
      setFeedback({tone:"success",text:result.branchIds.length>0?
        `Branch access saved for ${result.branchIds.length} location(s).`:
        "All branch access revoked. The POS attendant can no longer sign in."});
    }catch(error){
      setFeedback({tone:"error",text:errorMessage(error,"Branch assignment failed")});
    }finally{setBusyId(null);}
  };

  const copyInviteLink = async () => {
    if (!oneTimeInvite) return;
    try {
      await navigator.clipboard.writeText(oneTimeInvite.link);
      setFeedback({ tone: "success", text: "Invitation link copied. Share it only with the intended team member." });
    } catch {
      setFeedback({ tone: "error", text: "Invitation link could not be copied. Try again from a secure browser context." });
    }
  };

  if (!readable) {
    return (
      <section className="tos-team" aria-label="Team and access">
        <div className="tos-settings__callout">
          <IconUsers />
          <div><strong>You do not have team-directory access</strong><span>Only OWNER, ADMIN and MANAGER roles can view this business team.</span></div>
        </div>
      </section>
    );
  }

  const startEdit = (member: StaffDirectoryItem) => {
    if (!mutable || !canManageStaffRole(role, member.role)) return;
    setMode({ kind: "edit", staffId: member.id });
    setOneTimeInvite(null);
    setFeedback(null);
  };

  const renderActions = (member: StaffDirectoryItem) => {
    if (!mutable || !canManageStaffRole(role, member.role)) return <span className="tos-team__readonly">Read only</span>;
    const hasActiveAccess = member.access.membershipStatus === "ACTIVE";
    const hasPendingInvite = member.access.invitationStatus === "PENDING";
    return (
      <div className="tos-team__actions">
        <Button size="sm" variant="ghost" icon={<IconEdit />} disabled={!online || Boolean(busyId)} onClick={() => startEdit(member)}>Edit</Button>
        {member.role==="POS_ATTENDANT" ? (
          <Button size="sm" variant="outline" disabled={!online || Boolean(busyId)}
            onClick={()=>void openBranchAssignments(member)}>
            Assign branches
          </Button>
        ):null}
        {!hasActiveAccess && member.active ? (
          <Button size="sm" variant="outline" disabled={!online || Boolean(busyId)} loading={busyId === `invite:${member.id}`} onClick={() => void invite(member)}>
            {hasPendingInvite ? "New invite" : "Invite"}
          </Button>
        ) : null}
        {member.active ? (
          <Button size="sm" variant="danger" disabled={!online || Boolean(busyId)} loading={busyId === `suspend:${member.id}`} onClick={() => void setActive(member, false)}>Suspend</Button>
        ) : (
          <Button size="sm" variant="positive" disabled={!online || Boolean(busyId)} loading={busyId === `reactivate:${member.id}`} onClick={() => void setActive(member, true)}>Reactivate</Button>
        )}
      </div>
    );
  };

  return (
    <section className="tos-team" aria-label="Team and access">
      <div className="tos-team__toolbar">
        <div>
          <span className="tos-settings__mini-eyebrow">Business access</span>
          <h2 className="tos-settings__subheading">Team & access</h2>
          <p className="tos-settings__subtext">Manage staff records, app access and role assignments for this business.</p>
        </div>
        <div className="tos-settings__header-actions">
          <Button variant="outline" icon={<IconRefresh />} loading={loading} disabled={!online} onClick={() => void loadTeam()}>Refresh</Button>
          {mutable ? <Button variant="primary" icon={<IconPlus />} disabled={!online} onClick={() => { setMode(mode.kind === "create" ? { kind: "view" } : { kind: "create" }); setOneTimeInvite(null); setFeedback(null); }}>{mode.kind === "create" ? "Cancel" : "Add staff"}</Button> : null}
        </div>
      </div>

      {!online ? <div className="tos-team__notice" role="status">Team settings require an online connection. Existing data remains visible when available.</div> : null}
      {role === "MANAGER" ? <div className="tos-team__notice"><strong>Read-only team access</strong><span>You can review staff and access status, but only OWNER or ADMIN can make changes.</span></div> : null}
      {feedback ? <div className={`tos-settings__feedback tos-settings__feedback--${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}><span>{feedback.text}</span></div> : null}
      {loadError ? <div className="tos-settings__feedback tos-settings__feedback--error" role="alert"><span>Team directory could not be loaded. {loadError}</span><Button size="sm" variant="outline" disabled={!online} onClick={() => void loadTeam()}>Try again</Button></div> : null}

      {oneTimeInvite ? (
        <div className="tos-team__invite" role="status">
          <div>
            <strong>One-time invitation for {oneTimeInvite.staffName}</strong>
            <span>Expires {new Date(oneTimeInvite.expiresAt).toLocaleString()}. Copy it now; TradeOS does not store the raw token.</span>
          </div>
          <div className="tos-team__invite-link">
            <input className="tos-input" value={oneTimeInvite.link} readOnly aria-label="One-time invitation link" />
            <Button variant="primary" onClick={() => void copyInviteLink()}>Copy link</Button>
            <Button variant="ghost" onClick={() => setOneTimeInvite(null)}>Hide</Button>
          </div>
        </div>
      ) : null}

      {branchEditor && mutable ? (
        <section className="tos-section" aria-label="POS attendant branch assignments"
          style={{marginBottom:16,padding:16,border:"1px solid var(--tos-border,#cfd8e3)",
            borderRadius:12}}>
          <h3 style={{marginTop:0,fontSize:18}}>Branch access · {staff.find(s=>s.id===branchEditor.staffId)?.displayName??"Attendant"}</h3>
          <p style={{marginBottom:12}}>Select the active locations where this POS attendant may sell.
            Leaving all unchecked revokes POS access immediately on the server.</p>
          {branchEditor.loading ? <p role="status">Loading branch assignments…</p> : (
            <div style={{display:"grid",gap:10}}>
              {(businessContext?.branches??[]).filter(branch=>branch.active).map(branch=>(
                <label key={branch.id} style={{display:"flex",gap:10,alignItems:"center",
                  minHeight:44,cursor:"pointer",fontWeight:600}}>
                  <input type="checkbox" aria-label={`Allow ${branch.name}`}
                    checked={branchEditor.selected.includes(branch.id)}
                    onChange={event=>setBranchEditor(old=>old?{
                      ...old,selected:event.target.checked?
                        [...old.selected,branch.id]:
                        old.selected.filter(id=>id!==branch.id),
                    }:old)}/>
                  <span>{branch.name} ({branch.code})</span>
                </label>
              ))}
              {(businessContext?.branches??[]).filter(branch=>branch.active).length===0 ?
                <p role="alert">No active branches available. Create a branch in Business Settings first.</p>:null}
              <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                <Button variant="primary" disabled={Boolean(busyId)}
                  loading={busyId==="branches:"+branchEditor.staffId}
                  onClick={()=>void saveBranchAssignments()}>Save branch access</Button>
                <Button variant="ghost" disabled={Boolean(busyId)}
                  onClick={()=>setBranchEditor(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </section>
      ):null}

      {mode.kind === "create" && mutable ? <StaffEditor actorRole={role} busy={busyId === "create"} onSubmit={saveStaff} onCancel={() => setMode({ kind: "view" })} /> : null}
      {mode.kind === "edit" && editingStaff && mutable ? <StaffEditor actorRole={role} staff={editingStaff} busy={busyId === editingStaff.id} onSubmit={saveStaff} onCancel={() => setMode({ kind: "view" })} /> : null}

      {loading && staff.length === 0 ? <div className="tos-team__state"><span className="tos-spinner" /><strong>Loading team members…</strong></div> : null}
      {!loading && !loadError && staff.length === 0 ? <div className="tos-team__state"><IconUsers /><strong>No staff members yet</strong><span>{mutable ? "Add the first staff member to begin managing team access." : "No staff records are available for this business."}</span></div> : null}

      {staff.length > 0 ? (
        <>
          <div className="tos-team__table-wrap">
            <table className="tos-team__table">
              <thead><tr><th>Staff member</th><th>Role</th><th>Status</th><th>App access</th><th>Actions</th></tr></thead>
              <tbody>{staff.map((member) => (
                <tr key={member.id}>
                  <td><strong>{member.displayName}</strong><span>{member.email ?? member.phone ?? "No contact set"}</span></td>
                  <td>{friendlyRole(member.role)}</td>
                  <td><span className={`tos-badge ${member.active ? "tos-badge--positive" : "tos-badge--muted"}`}>{member.active ? "Active" : "Suspended"}</span></td>
                  <td>{accessLabel(member)}</td>
                  <td>{renderActions(member)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="tos-team__cards">
            {staff.map((member) => (
              <article key={member.id} className="tos-team__card">
                <div className="tos-team__card-head"><div><strong>{member.displayName}</strong><span>{friendlyRole(member.role)}</span></div><span className={`tos-badge ${member.active ? "tos-badge--positive" : "tos-badge--muted"}`}>{member.active ? "Active" : "Suspended"}</span></div>
                <dl className="tos-team__meta"><div><dt>Contact</dt><dd>{member.email ?? member.phone ?? "Not set"}</dd></div><div><dt>App access</dt><dd>{accessLabel(member)}</dd></div></dl>
                {renderActions(member)}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function accessLabel(member: StaffDirectoryItem): string {
  if (member.access.membershipStatus === "ACTIVE") return "Active login";
  if (member.access.membershipStatus === "SUSPENDED") return "Login suspended";
  if (member.access.invitationStatus === "PENDING") return "Invitation pending";
  if (member.access.invitationStatus === "EXPIRED") return "Invitation expired";
  return "No app access";
}

function friendlyRole(role: BusinessRole): string {
  return role.charAt(0) + role.slice(1).toLowerCase().replaceAll("_", " ");
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
