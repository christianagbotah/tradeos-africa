"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Banner, PageHeader, Section } from "../../components/admin-ui";
import { IconActivity, IconInfo } from "../../components/icons";
import { useAdminResource, usePlatformAdminSession } from "../../components/platform-admin-session";
import { AiInsightCard } from "../../components/ai-insight-card";
import { ApprovalCard } from "../../components/approval-card";

interface AutomationPolicy {
  id: string;
  code: string;
  name: string;
  description: string | null;
  enabled: boolean;
  businessId: string | null;
  triggerType: string;
  actionType: string;
  executionClass: number;
  approvalRole: string | null;
  policyVersion: number;
  updatedAt: string;
}

interface AutomationRun {
  id: string;
  policyId: string;
  policyVersion: number;
  businessId: string | null;
  triggerSource: string;
  triggerCorrelationId: string;
  state: string;
  executionClass: number;
  proposedAction: Record<string, unknown>;
  evidence: unknown[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Recommendation {
  id: string;
  title: string;
  summary: string;
  priority: string;
  businessId: string | null;
  evidence: unknown[];
  executionClass: number;
}

interface QueryResult {
  answer: string;
  recommendations: Recommendation[];
  evidence: unknown[];
  generatedAt: string;
}

export default function AutomationPage() {
  const { apiFetch } = usePlatformAdminSession();
  const policies = useAdminResource<{ policies: AutomationPolicy[] }>("/api/admin/automation/policies");
  const runs = useAdminResource<{ runs: AutomationRun[] }>("/api/admin/automation/runs");
  const policyById = useMemo(() => new Map((policies.data?.policies ?? []).map((policy) => [policy.id, policy])), [policies.data]);
  const waiting = (runs.data?.runs ?? []).filter((run) => run.state === "WAITING_APPROVAL");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [queryBusy, setQueryBusy] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [policyCode, setPolicyCode] = useState("");
  const [policyName, setPolicyName] = useState("");
  const [policyReason, setPolicyReason] = useState("");
  const [policyBusy, setPolicyBusy] = useState(false);

  async function decide(run: AutomationRun, decision: "approve" | "reject") {
    const reason = reasons[run.id]?.trim() ?? "";
    if (!reason) return;
    setBusyRunId(run.id);
    setPageError(null);
    try {
      const response = await apiFetch(`/api/admin/automation/runs/${run.id}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `Decision failed (${response.status})`);
      setReasons((current) => ({ ...current, [run.id]: "" }));
      await runs.reload();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Automation decision failed.");
    } finally {
      setBusyRunId(null);
    }
  }

  async function retryRun(run: AutomationRun) {
    const reason = window.prompt("Reason for retrying this failed run?")?.trim();
    if (!reason) return;
    if (!window.confirm("Retry this failed automation run now?")) return;
    setBusyRunId(run.id);
    setPageError(null);
    try {
      const response = await apiFetch(`/api/admin/automation/runs/${run.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `Retry failed (${response.status})`);
      await runs.reload();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Automation retry failed.");
    } finally {
      setBusyRunId(null);
    }
  }

  async function evaluatePolicy(policy: AutomationPolicy) {
    if (!window.confirm(`Evaluate ${policy.name} now?`)) return;
    setPageError(null);
    try {
      const response = await apiFetch("/api/admin/automation/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: policy.id,
          correlationId: `manual:${policy.id}:${Date.now()}`,
          triggerSource: "MANUAL",
          structuredInput: {},
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `Evaluation failed (${response.status})`);
      await runs.reload();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Policy evaluation failed.");
    }
  }

  async function askTradeOS(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setQueryBusy(true);
    setPageError(null);
    try {
      const response = await apiFetch("/api/admin/intelligence/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          correlationId: `admin-query:${crypto.randomUUID()}`,
          tools: ["platform_metrics", "attention_items", "invoice_payment_summary", "device_sync_health", "release_health", "recent_audit_summary"],
        }),
      });
      const body = await response.json().catch(() => ({})) as QueryResult & { message?: string };
      if (!response.ok) throw new Error(body.message ?? `AI query failed (${response.status})`);
      setQueryResult(body);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "TradeOS intelligence is unavailable.");
    } finally {
      setQueryBusy(false);
    }
  }

  async function createRecordOnlyPolicy(event: FormEvent) {
    event.preventDefault();
    if (!policyCode.trim() || !policyName.trim() || !policyReason.trim()) return;
    setPolicyBusy(true);
    setPageError(null);
    try {
      const response = await apiFetch("/api/admin/automation/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: policyCode.trim().toUpperCase(),
          name: policyName.trim(),
          description: "Record-only policy created from AI Operations.",
          enabled: true,
          triggerType: "MANUAL",
          conditions: {},
          actionType: "RECORD_ONLY",
          actionConfiguration: {},
          executionClass: 0,
          approvalRole: null,
          reason: policyReason.trim(),
        }),
      });
      const body = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? `Policy creation failed (${response.status})`);
      setPolicyCode("");
      setPolicyName("");
      setPolicyReason("");
      await policies.reload();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Automation policy could not be created.");
    } finally {
      setPolicyBusy(false);
    }
  }

  return (
    <div className="admin-page">
      <PageHeader
        eyebrow="AI operations"
        title="Intelligence & automation center"
        subtitle="Grounded platform intelligence, deterministic attention signals, approval-controlled actions and auditable automation runs."
      />
      <Banner icon={IconInfo} title="AI recommends. TradeOS controls execution.">
        <span className="admin-banner__text">Class 2 actions require an authorized human approval. Class 3 security and financial actions are never delegated to AI.</span>
      </Banner>
      {pageError ? <div className="admin-api-state admin-api-state--error" role="alert">{pageError}</div> : null}

      <Section title="Ask TradeOS" sub="Ask a platform-operations question. Answers are grounded only in allow-listed authoritative records.">
        <form className="admin-ai-query" onSubmit={askTradeOS}>
          <textarea
            className="admin-field__input admin-billing-textarea"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Which tenants need attention today, and why?"
            maxLength={2000}
          />
          <button className="admin-primary-button" type="submit" disabled={queryBusy || !question.trim()}>{queryBusy ? "Analyzing…" : "Ask TradeOS"}</button>
        </form>
        {queryResult ? (
          <div className="admin-ai-answer">
            <span className="admin-ai-kicker">Grounded answer</span>
            <p>{queryResult.answer}</p>
            <small>Evidence: {queryResult.evidence.length} authoritative record set(s) · generated {new Date(queryResult.generatedAt).toLocaleString()}</small>
            <div className="admin-ai-grid">
              {queryResult.recommendations.map((recommendation) => (
                <AiInsightCard
                  key={recommendation.id}
                  finding={recommendation.title}
                  severity={recommendation.priority}
                  evidence={recommendation.evidence}
                  recommendation={recommendation.summary}
                  recordHref={recommendation.businessId ? `/console/tenants/${recommendation.businessId}` : "/console/automation"}
                  generatedAt={queryResult.generatedAt}
                />
              ))}
            </div>
          </div>
        ) : null}
      </Section>

      <Section title="Waiting approvals" sub={`${waiting.length} automation run(s) currently require an authorized human decision.`}>
        {runs.loading ? <div className="admin-api-state">Loading approval queue…</div> : null}
        {runs.error ? <div className="admin-api-state admin-api-state--error">{runs.error}</div> : null}
        {!runs.loading && waiting.length === 0 ? <div className="admin-api-state">No automation runs are waiting for approval.</div> : null}
        <div className="admin-ai-grid">
          {waiting.map((run) => {
            const policy = policyById.get(run.policyId);
            return (
              <ApprovalCard
                key={run.id}
                proposedAction={formatAction(run.proposedAction)}
                impact={`Execution class ${run.executionClass}; canonical services revalidate the target before mutation.`}
                target={run.businessId ? `Tenant ${run.businessId}` : "Platform scope"}
                evidence={run.evidence}
                requiredRole={policy?.approvalRole ?? "Authorized approver"}
                reason={reasons[run.id] ?? ""}
                onReasonChange={(value) => setReasons((current) => ({ ...current, [run.id]: value }))}
                onApprove={() => void decide(run, "approve")}
                onReject={() => void decide(run, "reject")}
                busy={busyRunId === run.id}
              />
            );
          })}
        </div>
      </Section>

      <Section title="Automation policies" sub="Policies are versioned. High-risk actions cannot be delegated, and approval-controlled runs preserve the policy version used at evaluation time.">
        {policies.loading ? <div className="admin-api-state">Loading automation policies…</div> : null}
        {policies.error ? <div className="admin-api-state admin-api-state--error">{policies.error}</div> : null}
        <div className="admin-ai-grid">
          {(policies.data?.policies ?? []).map((policy) => (
            <article className="admin-ai-card" key={policy.id}>
              <div className="admin-ai-card__head"><div><span className="admin-ai-kicker">{policy.code}</span><h3>{policy.name}</h3></div><span className="admin-ai-role">v{policy.policyVersion}</span></div>
              <p>{policy.description ?? "No policy description."}</p>
              <div className="admin-ai-facts">
                <div><span>Trigger</span><strong>{policy.triggerType}</strong></div>
                <div><span>Action</span><strong>{policy.actionType}</strong></div>
                <div><span>Class</span><strong>{policy.executionClass}</strong></div>
                <div><span>Status</span><strong>{policy.enabled ? "Enabled" : "Disabled"}</strong></div>
              </div>
              <button type="button" className="admin-secondary-button" disabled={!policy.enabled} onClick={() => void evaluatePolicy(policy)}>Evaluate now</button>
            </article>
          ))}
        </div>
        <form className="admin-ai-policy-form" onSubmit={createRecordOnlyPolicy}>
          <h3>Create safe record-only policy</h3>
          <input className="admin-field__input" value={policyCode} onChange={(event) => setPolicyCode(event.target.value)} placeholder="POLICY_CODE" maxLength={100} />
          <input className="admin-field__input" value={policyName} onChange={(event) => setPolicyName(event.target.value)} placeholder="Policy name" maxLength={160} />
          <textarea className="admin-field__input admin-billing-textarea" value={policyReason} onChange={(event) => setPolicyReason(event.target.value)} placeholder="Reason for creating this policy" maxLength={500} />
          <button className="admin-primary-button" type="submit" disabled={policyBusy || !policyCode.trim() || !policyName.trim() || !policyReason.trim()}>{policyBusy ? "Creating…" : "Create policy"}</button>
        </form>
      </Section>

      <Section title="Run history" sub="Every automation run is idempotent, version-pinned and auditable.">
        <div className="admin-ai-grid">
          {(runs.data?.runs ?? []).map((run) => (
            <article className="admin-ai-card admin-ai-run" key={run.id}>
              <div className="admin-ai-card__head"><div><span className="admin-ai-kicker">{run.state}</span><h3>{formatAction(run.proposedAction)}</h3></div><span className="admin-ai-role">class {run.executionClass}</span></div>
              <div className="admin-ai-facts">
                <div><span>Policy version</span><strong>v{run.policyVersion}</strong></div>
                <div><span>Trigger</span><strong>{run.triggerSource}</strong></div>
                <div><span>Created</span><strong>{new Date(run.createdAt).toLocaleString()}</strong></div>
              </div>
              <div className="admin-ai-evidence"><strong>Evidence</strong><span>{run.evidence.length} structured reference(s)</span></div>
              {run.errorMessage ? <div className="admin-api-state admin-api-state--error">{run.errorCode ?? "FAILED"}: {run.errorMessage}</div> : null}
              {run.state === "FAILED" && run.executionClass <= 1 ? <button type="button" className="admin-secondary-button" disabled={busyRunId === run.id} onClick={() => void retryRun(run)}>Retry failed run</button> : null}
            </article>
          ))}
        </div>
      </Section>
    </div>
  );
}

function formatAction(action: Record<string, unknown>): string {
  const type = typeof action.type === "string" ? action.type : "Proposed automation action";
  return type.toLowerCase().split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
