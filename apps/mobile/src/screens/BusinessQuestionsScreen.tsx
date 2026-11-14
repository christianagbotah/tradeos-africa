import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { BusinessQuestionResponse, BusinessQuestionFact } from "@tradeos/contracts";
import type { MobileApiClient } from "../api-client";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { formatMoney } from "../lib/format";
import { canAskMobileBusinessQuestions, questionResponseMatchesContext } from "../question-scope";
import { colors, radius, spacing, typography } from "../theme";

const PROMPTS = [
  "How much did we sell today?",
  "What is our cash balance?",
  "Who owes us money?",
  "Which stock needs replenishment?",
] as const;

export type BusinessQuestionsScreenProps = {
  api: Pick<MobileApiClient, "askBusinessQuestion">;
  businessId: string;
  branchId: string;
  role: string;
  online: boolean;
  pendingCount: number;
  failedCount: number;
  onBack: () => void;
};

function readableEvidence(item: BusinessQuestionFact, currencyCode: string | null): string {
  if (item.unit === "MINOR") return formatMoney(item.value, currencyCode ?? "GHS");
  return item.value.toLocaleString("en-GH", { maximumFractionDigits: 3 }) +
    (item.unit === "STOCK_UNITS" ? " stock units" : "");
}

/**
 * A scoped, deterministic reader for recorded business figures. No local AI
 * provider, no unrestricted SQL, no sales/inventory writes, no cached answers
 * crossing accounts. Offline work is entirely unaffected by this optional UI.
 */
export function BusinessQuestionsScreen({
  api, businessId, branchId, role, online, pendingCount, failedCount, onBack,
}: BusinessQuestionsScreenProps) {
  const allowed = canAskMobileBusinessQuestions(role);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BusinessQuestionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    if (!online || !allowed) {
      sequence.current += 1;
      setResult(null);
      setError(null);
      setBusy(false);
    }
    return () => { sequence.current += 1; };
  }, [businessId, branchId, online, allowed]);

  const canSubmit = allowed && online && !busy && question.trim().length >= 4 &&
    question.trim().length <= 400;

  async function ask(textOverride?: string) {
    const asked = (textOverride ?? question).trim();
    if (!allowed || !online || busy || asked.length < 4 || asked.length > 400) return;
    const current = ++sequence.current;
    setQuestion(asked);
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const response = await api.askBusinessQuestion(businessId, branchId, asked);
      if (sequence.current !== current) return;
      if (!questionResponseMatchesContext(response, businessId, branchId)) {
        setError("TradeOS returned a response from a different branch. No information was shown.");
        return;
      }
      setResult(response);
    } catch {
      if (sequence.current === current) {
        setError("The question could not be answered. Check the connection and try again.");
      }
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <WorkspaceHeader online={online} syncing={false} pendingCount={pendingCount} failedCount={failedCount} />
      <View style={styles.heading}>
        <View style={styles.headingText}>
          <Text style={styles.eyebrow}>Business intelligence</Text>
          <Text style={styles.title}>Ask TradeOS</Text>
          <Text style={styles.subtitle}>Answers grounded in recorded sales, credit and inventory.</Text>
        </View>
        <Button variant="secondary" size="compact" accessibilityLabel="Go back to More"
          onPress={onBack}>Back</Button>
      </View>
      {!allowed ? (
        <Banner tone="warning" title="Not permitted"
          message="Your role cannot access private business intelligence." />
      ) : !online ? (
        <Banner tone="info" title="Offline"
          message="Questions require current server reports. Continue recording sales offline and ask when connected." />
      ) : (
        <>
          <Card style={styles.formCard}>
            <Text style={styles.sectionTitle}>What do you want to know?</Text>
            <Text style={styles.support}>
              Questions are answered from TradeOS records, not fabricated model estimates.
              You can ask about sales, profit, cash, credit, best sellers and stock.
            </Text>
            <View style={styles.prompts}>
              {PROMPTS.map((prompt) => (
                <Button key={prompt} variant="secondary" size="compact"
                  accessibilityLabel={prompt} disabled={busy}
                  onPress={() => { void ask(prompt); }}>{prompt}</Button>
              ))}
            </View>
            <Text style={styles.inputLabel}>Your question</Text>
            <TextInput
              accessibilityLabel="Your business question"
              multiline
              value={question}
              onChangeText={setQuestion}
              placeholder="e.g. What sold best this month?"
              placeholderTextColor={colors.textSoft}
              editable={!busy}
              maxLength={400}
              style={styles.input}
              autoCorrect
              returnKeyType="done"
            />
            <Button variant="primary" fullWidth accessibilityLabel="Ask TradeOS"
              disabled={!canSubmit} loading={busy}
              onPress={() => { void ask(); }}>
              {busy ? "Checking records…" : "Ask TradeOS"}
            </Button>
          </Card>
          {busy ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.goldStrong} />
              <Text style={styles.support}>Checking the recorded business figures…</Text>
            </View>
          ) : null}
          {error ? <Banner tone="danger" title="Question unavailable" message={error} /> : null}
          {result ? (
            <Card style={styles.answerCard}>
              <Text style={styles.eyebrow}>Grounded answer</Text>
              <Text style={styles.answer}>{result.answer}</Text>
              <Text style={styles.meta}>
                {new Date(result.generatedAt).toLocaleString("en-GH",
                  { dateStyle: "medium", timeStyle: "short" })} · Data quality: {result.dataQuality.toLowerCase()}
              </Text>
              {result.items.map((item) => (
                <View key={item.id} style={styles.item}>
                  <Text style={styles.itemTitle}>{item.label}</Text>
                  <Text style={styles.support}>{item.detail}</Text>
                </View>
              ))}
              {result.evidence.length ? (
                <View style={styles.evidence}>
                  <Text style={styles.sectionTitle}>Supporting figures</Text>
                  {result.evidence.map((item) => (
                    <View key={item.key} style={styles.fact}>
                      <Text style={styles.support}>{item.label}</Text>
                      <Text style={styles.factValue}>
                        {readableEvidence(item, result.currencyCode)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {result.limitations.length ? (
                <View style={styles.limitations}>
                  <Text style={styles.meta}>{result.limitations.join(" ")}</Text>
                </View>
              ) : null}
              {result.sourcePage ? (
                <Text style={styles.footer}>
                  To investigate further, open {result.sourcePage} in your TradeOS business web dashboard.
                </Text>
              ) : null}
            </Card>
          ) : null}
          <Text style={styles.footer}>
            This service is read-only. It does not make payments, purchases or stock adjustments.
            Answers require an internet connection.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow:1, gap:spacing.s4, paddingHorizontal:spacing.s4,
    paddingBottom:spacing.s8, backgroundColor:colors.canvas },
  heading: { flexDirection:"row", alignItems:"center", justifyContent:"space-between",
    gap:spacing.s3, marginTop:spacing.s2 },
  headingText: { flex:1, gap:spacing.s1 },
  eyebrow: { color:colors.goldStrong, fontSize:typography.meta, fontWeight:typography.weightHeavy,
    textTransform:"uppercase", letterSpacing:typography.kickerTracking },
  title: { color:colors.textStrong, fontSize:typography.display,
    fontWeight:typography.weightBlack },
  subtitle: { color:colors.textMuted, fontSize:typography.supporting,
    lineHeight:typography.supportingLine },
  formCard: { gap:spacing.s3 },
  sectionTitle: { color:colors.textStrong, fontSize:typography.body,
    fontWeight:typography.weightBlack },
  support: { color:colors.textMuted, fontSize:typography.supporting,
    lineHeight:typography.supportingLine },
  prompts: { gap:spacing.s2 },
  inputLabel: { color:colors.textStrong, fontSize:typography.supporting,
    fontWeight:typography.weightBold },
  input: { minHeight:86, padding:spacing.s3, borderWidth:1, borderColor:colors.borderStrong,
    borderRadius:radius.sm, backgroundColor:colors.surfaceSoft,
    fontSize:typography.body, lineHeight:typography.bodyLine, color:colors.textStrong,
    textAlignVertical:"top" },
  loading: { flexDirection:"row", alignItems:"center", gap:spacing.s2 },
  answerCard: { gap:spacing.s3 },
  answer: { fontSize:typography.body, lineHeight:typography.bodyLine, color:colors.text },
  meta: { color:colors.textSoft, fontSize:typography.meta, lineHeight:typography.metaLine },
  item: { padding:spacing.s3, backgroundColor:colors.surfaceSoft, borderRadius:radius.sm, gap:spacing.s1 },
  itemTitle: { color:colors.textStrong, fontWeight:typography.weightBlack,
    fontSize:typography.supporting },
  evidence: { gap:spacing.s2 },
  fact: { flexDirection:"row", justifyContent:"space-between", flexWrap:"wrap",
    alignItems:"center", gap:spacing.s2 },
  factValue: { color:colors.textStrong, fontWeight:typography.weightBlack,
    fontSize:typography.supporting },
  limitations: { borderRadius:radius.sm, backgroundColor:colors.warningSoft,
    padding:spacing.s3 },
  footer: { color:colors.textMuted, fontSize:typography.meta, lineHeight:typography.metaLine },
});
