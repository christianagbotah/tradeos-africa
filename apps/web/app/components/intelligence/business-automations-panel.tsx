"use client";

import { useMemo, useState } from "react";
import type { BusinessAutomationPolicy, BusinessAutomationRun } from "@tradeos/contracts";
import { getOfflineQueue } from "../../../lib/offline-sync";
import { useApiFetch } from "../../../lib/use-api-fetch";
import { Button } from "../ui/button";
import { StatePanel } from "../ui/state-panel";
import { BusinessAutomationEffectivenessPanel } from "./business-automation-effectiveness-panel";
import { useWorkspace } from "../workspace/use-workspace";
import {
  canControlBusinessAutomationPolicy,
  canManageBusinessAutomations,
  createGuidedAutomationDraft,
  guidedAutomationDraftFromPolicy,
  guidedAutomationTemplates,
  mutateBusinessAutomationPolicy,
  relevantBusinessAutomationPolicies,
  runBusinessAutomationNow,
  saveGuidedBusinessAutomationPolicy,
  type GuidedAutomationDraft,
  type GuidedAutomationSeverityThreshold,
  type GuidedAutomationTemplateId,
} from "./business-automations";

interface AutomationPoliciesResponse {
  policies: BusinessAutomationPolicy[];
}

interface RunFeedback {
  policyId: string;
  run: BusinessAutomationRun;
}

interface GuidedEditorState {
  draft: GuidedAutomationDraft;
  existingPolicy: BusinessAutomationPolicy | null;
}

export function BusinessAutomationsPanel() {
  const { session, role, queue, businessContext } = useWorkspace();
  const allowed = canManageBusinessAutomations(role);
  const templates = useMemo(() => guidedAutomationTemplates(role), [role]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<RunFeedback | null>(null);
  const [editor, setEditor] = useState<GuidedEditorState | null>(null);

  const policiesPath = allowed && session && queue.online
    ? `/v1/intelligence/automations?businessId=${encodeURIComponent(session.businessId)}`
    : null;
  const policiesQuery = useApiFetch<AutomationPoliciesResponse>(policiesPath);
  const policies = useMemo(
    () => session
      ? relevantBusinessAutomationPolicies(policiesQuery.data?.policies ?? [], session.branchId)
      : [],
    [policiesQuery.data, session],
  );
  const reviewablePolicyIds = useMemo(() => new Set(
    session
      ? policies
        .filter((policy) => canControlBusinessAutomationPolicy(role, policy) && guidedAutomationDraftFromPolicy(policy, session.branchId) !== null)
        .map((policy) => policy.id)
      : [],
  ), [policies, role, session]);

  if (!allowed || !session) return null;

  const currentBranchName = businessContext?.branches.find((branch) => branch.id === session.branchId)?.name ?? "Current branch";
  const selectedTemplate = editor ? templates.find((template) => template.id === editor.draft.templateId) ?? null : null;

  const openCreate = () => {
    const template = templates[0];
    if (!template || !queue.online || busyKey) return;
    setMutationError(null);
    setLastRun(null);
    setEditor({
      draft: createGuidedAutomationDraft({
        businessId: session.businessId,
        currentBranchId: session.branchId,
        templateId: template.id,
        code: `guided-${template.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      }),
      existingPolicy: null,
    });
  };

  const openEdit = (policy: BusinessAutomationPolicy) => {
    const draft = guidedAutomationDraftFromPolicy(policy, session.branchId);
    if (!draft || !canControlBusinessAutomationPolicy(role, policy) || !queue.online || busyKey) return;
    setMutationError(null);
    setLastRun(null);
    setEditor({ draft, existingPolicy: policy });
  };

  const reviewEffectivenessPolicy = (policyId: string) => {
    const policy = policies.find((policy) => policy.id === policyId);
    if (!policy || !reviewablePolicyIds.has(policyId)) return;
    openEdit(policy);
  };

  const changeTemplate = (templateId: GuidedAutomationTemplateId) => {
    if (!editor || editor.existingPolicy) return;
    setEditor({
      existingPolicy: null,
      draft: createGuidedAutomationDraft({
        businessId: session.businessId,
        currentBranchId: session.branchId,
        templateId,
        code: `guided-${templateId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      }),
    });
  };

  const saveEditor = async () => {
    if (!editor || !queue.online || busyKey) return;
    setBusyKey("editor:save");
    setMutationError(null);
    try {
      const saved = await saveGuidedBusinessAutomationPolicy(
        (input, init) => getOfflineQueue().authenticatedFetch(input, init),
        {
          draft: editor.draft,
          ...(editor.existingPolicy ? { existingPolicy: editor.existingPolicy } : {}),
        },
      );
      const current = policiesQuery.data?.policies ?? [];
      const exists = current.some((candidate) => candidate.id === saved.id);
      policiesQuery.setData({
        policies: exists
          ? current.map((candidate) => candidate.id === saved.id ? saved : candidate)
          : [...current, saved],
      });
      setEditor(null);
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Automation policy could not be saved.");
      if (editor.existingPolicy) policiesQuery.refetch();
    } finally {
      setBusyKey(null);
    }
  };

  const togglePolicy = async (policy: BusinessAutomationPolicy) => {
    if (!queue.online || busyKey) return;
    const key = `${policy.id}:toggle`;
    setBusyKey(key);
    setMutationError(null);
    setLastRun(null);
    try {
      const updated = await mutateBusinessAutomationPolicy(
        (input, init) => getOfflineQueue().authenticatedFetch(input, init),
        { policy, businessId: session.businessId, enabled: !policy.enabled },
      );
      policiesQuery.setData({
        policies: (policiesQuery.data?.policies ?? []).map((candidate) => candidate.id === updated.id ? updated : candidate),
      });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Automation policy could not be updated.");
      policiesQuery.refetch();
    } finally {
      setBusyKey(null);
    }
  };

  const runNow = async (policy: BusinessAutomationPolicy) => {
    if (!queue.online || busyKey || !policy.enabled) return;
    const key = `${policy.id}:run`;
    setBusyKey(key);
    setMutationError(null);
    setLastRun(null);
    try {
      const correlationId = `manual:${policy.id}:${Date.now()}:${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const run = await runBusinessAutomationNow(
        (input, init) => getOfflineQueue().authenticatedFetch(input, init),
        {
          policy,
          businessId: session.businessId,
          branchId: session.branchId,
          correlationId,
        },
      );
      setLastRun({ policyId: policy.id, run });
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Automation could not be run.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="tos-ai-automations" aria-labelledby="tradeos-ai-automations-title">
      <div className="tos-ai-automations__head">
        <div>
          <span className="tos-ai-eyebrow">AI workflow control</span>
          <h2 id="tradeos-ai-automations-title">AI Automations</h2>
          <p>Review and control safe workflow automations for this business. Enabled attention automations are checked automatically and create internal work items only; they do not move money, issue refunds, or change stock directly.</p>
        </div>
        <div className="tos-ai-automations__head-actions">
          <span className="tos-ai-count">{policies.length}</span>
          <Button size="sm" variant="gold" disabled={!queue.online || Boolean(busyKey) || templates.length === 0} onClick={openCreate}>
            Create automation
          </Button>
        </div>
      </div>

      <BusinessAutomationEffectivenessPanel reviewablePolicyIds={reviewablePolicyIds} onReviewPolicy={reviewEffectivenessPolicy} />

      {!queue.online ? (
        <div className="tos-ai-automation-offline" role="status">
          Reconnect to review or change automation policies. Offline sales and sync workflows remain available separately.
        </div>
      ) : policiesQuery.loading ? (
        <StatePanel inline bare variant="loading" title="Loading automations" text="Reading the latest policy controls for this business." />
      ) : policiesQuery.error ? (
        <StatePanel
          inline
          bare
          variant="error"
          title="Automations could not be loaded"
          text={policiesQuery.error}
          actionLabel="Retry"
          onAction={() => policiesQuery.refetch()}
        />
      ) : (
        <>
          {editor && selectedTemplate ? (
            <div className="tos-ai-automation-editor" aria-label={editor.existingPolicy ? "Edit automation" : "Create automation"}>
              <div className="tos-ai-automation-editor__head">
                <div>
                  <span className="tos-ai-eyebrow">Guided setup</span>
                  <h3>{editor.existingPolicy ? "Edit automation setup" : "Create automation"}</h3>
                </div>
                <Button size="sm" variant="ghost" disabled={Boolean(busyKey)} onClick={() => setEditor(null)}>Cancel</Button>
              </div>

              <div className="tos-ai-automation-editor__grid">
                <div className="tos-field">
                  <label className="tos-field__label" htmlFor="ai-automation-template">Automation template</label>
                  <select
                    id="ai-automation-template"
                    className="tos-select"
                    value={editor.draft.templateId}
                    disabled={Boolean(editor.existingPolicy) || Boolean(busyKey)}
                    onChange={(event) => changeTemplate(event.target.value as GuidedAutomationTemplateId)}
                  >
                    {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
                  </select>
                </div>

                <div className="tos-field">
                  <label className="tos-field__label" htmlFor="ai-automation-name">Automation name</label>
                  <input
                    id="ai-automation-name"
                    className="tos-input"
                    maxLength={160}
                    value={editor.draft.name}
                    disabled={Boolean(busyKey)}
                    onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, name: event.target.value } } : current)}
                  />
                </div>

                <div className="tos-field">
                  <label className="tos-field__label" htmlFor="ai-automation-scope">Scope</label>
                  <select
                    id="ai-automation-scope"
                    className="tos-select"
                    value={editor.draft.scope}
                    disabled={Boolean(busyKey)}
                    onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, scope: event.target.value as GuidedAutomationDraft["scope"] } } : current)}
                  >
                    <option value="CURRENT_BRANCH">{currentBranchName}</option>
                    <option value="BUSINESS_WIDE">Business-wide</option>
                  </select>
                </div>

                {selectedTemplate.triggerType === "ATTENTION" ? (
                  <>
                    <div className="tos-field">
                      <label className="tos-field__label" htmlFor="ai-automation-signal">Signal</label>
                      <select
                        id="ai-automation-signal"
                        className="tos-select"
                        value={editor.draft.signalRuleCode ?? ""}
                        disabled={Boolean(busyKey) || selectedTemplate.ruleOptions.length <= 1}
                        onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, signalRuleCode: event.target.value } } : current)}
                      >
                        {selectedTemplate.ruleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </div>

                    <div className="tos-field">
                      <label className="tos-field__label" htmlFor="ai-automation-severity">Severity threshold</label>
                      <select
                        id="ai-automation-severity"
                        className="tos-select"
                        value={editor.draft.severityThreshold}
                        disabled={Boolean(busyKey)}
                        onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, severityThreshold: event.target.value as GuidedAutomationSeverityThreshold } } : current)}
                      >
                        <option value="ANY">Any matching signal</option>
                        <option value="MEDIUM_PLUS">Medium or higher</option>
                        <option value="HIGH_PLUS">High or critical</option>
                        <option value="CRITICAL_ONLY">Critical only</option>
                      </select>
                    </div>
                  </>
                ) : null}

                <div className="tos-field">
                  <label className="tos-field__label" htmlFor="ai-automation-due">Due within</label>
                  <select
                    id="ai-automation-due"
                    className="tos-select"
                    value={String(editor.draft.dueInHours)}
                    disabled={Boolean(busyKey)}
                    onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, dueInHours: Number(event.target.value) } } : current)}
                  >
                    <option value="4">4 hours</option>
                    <option value="24">24 hours</option>
                    <option value="48">48 hours</option>
                    <option value="72">3 days</option>
                    <option value="168">7 days</option>
                  </select>
                </div>

                <div className="tos-ai-automation-editor__checks">
                  <label className="tos-ai-automation-check">
                    <input
                      type="checkbox"
                      checked={editor.draft.assignToActor}
                      disabled={Boolean(busyKey)}
                      onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, assignToActor: event.target.checked } } : current)}
                    />
                    <span>Assign to me</span>
                  </label>
                  <label className="tos-ai-automation-check">
                    <input
                      type="checkbox"
                      checked={editor.draft.enabled}
                      disabled={Boolean(busyKey)}
                      onChange={(event) => setEditor((current) => current ? { ...current, draft: { ...current.draft, enabled: event.target.checked } } : current)}
                    />
                    <span>Enabled</span>
                  </label>
                </div>
              </div>

              <div className="tos-ai-automation-preview">
                <strong>Preview</strong>
                <p>{selectedTemplate.preview}</p>
                <small>
                  {selectedTemplate.triggerType === "MANUAL"
                    ? "Manual template: it runs only when an authorized user chooses Run now."
                    : "Enabled attention automation: TradeOS checks this signal automatically in the background. Use Run now to test or create the internal workflow immediately."}
                </small>
              </div>

              <div className="tos-ai-automation-editor__actions">
                <Button size="sm" variant="ghost" disabled={Boolean(busyKey)} onClick={() => setEditor(null)}>Cancel</Button>
                <Button size="sm" variant="gold" loading={busyKey === "editor:save"} disabled={!queue.online || Boolean(busyKey)} onClick={() => void saveEditor()}>
                  {editor.existingPolicy ? "Save changes" : "Create automation"}
                </Button>
              </div>
            </div>
          ) : null}

          {mutationError ? <div className="tos-ai-error" role="alert">{mutationError}</div> : null}

          {policies.length === 0 ? (
            <StatePanel
              inline
              bare
              variant="empty"
              title="No automations configured"
              text="Create a guided automation to turn TradeOS signals into safe internal follow-up work."
              actionLabel="Create automation"
              onAction={openCreate}
            />
          ) : (
            <div className="tos-ai-automation-list">
              {policies.map((policy) => {
                const toggleKey = `${policy.id}:toggle`;
                const runKey = `${policy.id}:run`;
                const runFeedback = lastRun?.policyId === policy.id ? lastRun.run : null;
                const canControl = canControlBusinessAutomationPolicy(role, policy);
                const editable = guidedAutomationDraftFromPolicy(policy, session.branchId) !== null;
                return (
                  <article className="tos-ai-automation-card" key={policy.id}>
                    <div className="tos-ai-automation-card__body">
                      <div className="tos-ai-automation-card__title-row">
                        <div>
                          <h3>{policy.name}</h3>
                          <p>{policy.description ?? "Approved TradeOS workflow automation."}</p>
                        </div>
                        <span className="tos-ai-automation-status">{policy.enabled ? "Enabled" : "Paused"}</span>
                      </div>
                      <div className="tos-ai-automation-meta">
                        <span><strong>Scope:</strong> {policy.branchId === null ? "Business-wide" : currentBranchName}</span>
                        <span><strong>Trigger:</strong> {humanize(policy.triggerType)}</span>
                        <span><strong>Action:</strong> {humanize(policy.actionType)}</span>
                        <span><strong>Version:</strong> {policy.policyVersion}</span>
                        {!canControl ? <span><strong>Access:</strong> Owner/Admin control</span> : null}
                      </div>
                      {runFeedback ? (
                        <div className="tos-ai-automation-feedback" role="status">
                          Last run: {humanize(runFeedback.state)}
                          {runFeedback.errorMessage ? ` · ${runFeedback.errorMessage}` : " · workflow result recorded"}
                        </div>
                      ) : null}
                    </div>
                    <div className="tos-ai-automation-card__actions">
                      {editable ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!queue.online || Boolean(busyKey) || !canControl}
                          title={canControl ? "Edit this guided automation" : "This policy requires Owner or Admin control"}
                          onClick={() => openEdit(policy)}
                        >
                          Edit setup
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant={policy.enabled ? "outline" : "positive"}
                        loading={busyKey === toggleKey}
                        disabled={!queue.online || Boolean(busyKey) || !canControl}
                        title={canControl ? undefined : "This policy requires Owner or Admin control"}
                        onClick={() => void togglePolicy(policy)}
                      >
                        {policy.enabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="gold"
                        loading={busyKey === runKey}
                        disabled={!queue.online || Boolean(busyKey) || !policy.enabled || !canControl}
                        title={!canControl
                          ? "This policy requires Owner or Admin control"
                          : policy.enabled ? "Run this approved automation now" : "Enable this automation before running it"}
                        onClick={() => void runNow(policy)}
                      >
                        Run now
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
