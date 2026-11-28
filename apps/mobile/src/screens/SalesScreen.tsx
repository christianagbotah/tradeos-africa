import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import type {SaleReversal} from "../sale-reversal";
import type {ReceiptOutcome} from "../customer-payment";
import type {MobileActionFeedback} from "../action-feedback";
import { PostedSalesHistory } from "./PostedSalesHistory";
import type { MobileApiClient } from "../api-client";
import { IconTile } from "../components/icons";
import { colors, spacing, typography } from "../theme";
import type { MobileAppSnapshot } from "../app-model";

export type SalesScreenProps = {
  snapshot: MobileAppSnapshot;
  api: MobileApiClient;
  onSync: () => void;
  onGoToSell: () => void;
  onReversal:(input:SaleReversal)=>Promise<ReceiptOutcome>;
  onFeedback:(feedback:MobileActionFeedback)=>void;
};

export function SalesScreen({ snapshot, api, onSync, onGoToSell,onReversal,onFeedback }: SalesScreenProps) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const queue = ready.queue;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.title}>Sales history</Text>
          <Text style={styles.sectionCopy}>{ready.branch.name}</Text>
        </View>
        <Button variant="gold" accessibilityLabel="Start a new sale" onPress={onGoToSell}>New sale</Button>
      </View>
      <Card padding="compact" variant="flat" style={styles.section}>
        <View style={styles.sectionHeader}>
          <IconTile name="sync" size={36} background={colors.goldSoft} tint={colors.midnight}/>
          <Text accessibilityRole="header" style={[styles.sectionTitle,styles.flex]}>Sync queue</Text>
          <Button variant="secondary" disabled={snapshot.syncing || snapshot.online !== true || queue.pending === 0}
            loading={snapshot.syncing} accessibilityLabel="Sync pending sales now" onPress={onSync}>Sync now</Button>
        </View>
        <View style={styles.statGrid}>
          <QueueMetric label="Pending sync" value={queue.pending} color={queue.pending>0?colors.warning:colors.textStrong}/>
          <QueueMetric label="Other business" value={queue.blocked} color={queue.blocked>0?colors.info:colors.textStrong}/>
          <QueueMetric label="Needs review" value={queue.failed} color={queue.failed>0?colors.danger:colors.textStrong}/>
        </View>
        {queue.blocked>0?<Text style={styles.helperText}>Other business records are held locally until that business is active.</Text>:null}
        {snapshot.online === false?<Banner tone="info" title="Working offline" message="Pending records will sync automatically when you reconnect."/>:null}
        {queue.failed>0?<Banner tone="danger" title="Needs review" message="Rejected transactions are preserved on this device. Open the web workspace to inspect the reason and resubmit, or contact your business admin."/>:null}
      </Card>

      <PostedSalesHistory
        key={ready.user.id+":"+ready.membership.businessId+":"+ready.branch.id+":"+ready.membership.role}
        api={api} businessId={ready.membership.businessId} branchId={ready.branch.id}
        role={ready.membership.role} timezone={ready.branch.timezone}
        online={snapshot.online===true} syncing={snapshot.syncing} pendingCount={queue.pending} onReversal={onReversal} onFeedback={onFeedback}/>
    </ScrollView>
  );
}

function QueueMetric({label,value,color}:{label:string;value:number;color:string}){
  return <View style={styles.metric} accessibilityLabel={label+": "+value}>
    <Text style={[styles.metricValue,{color}]}>{value}</Text>
    <Text style={styles.metricLabel}>{label}</Text>
  </View>;
}

const styles=StyleSheet.create({
  content:{paddingTop:spacing.s3,flexGrow:1,backgroundColor:colors.canvas,paddingHorizontal:spacing.s4,paddingBottom:spacing.s6,gap:spacing.s3},
  title:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},
  section:{gap:spacing.s3},
  sectionHeader:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:spacing.s2},
  flex:{flex:1,minWidth:0},
  sectionTitle:{color:colors.textStrong,fontSize:typography.body,fontWeight:typography.weightBold,lineHeight:typography.bodyLine},
  sectionCopy:{color:colors.textMuted,fontSize:typography.supporting,lineHeight:typography.supportingLine},
  statGrid:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},
  metric:{flexGrow:1,flexBasis:78,minWidth:78,padding:spacing.s2,backgroundColor:colors.surfaceSoft,gap:spacing.s1},
  metricValue:{fontSize:typography.kpi,fontWeight:typography.weightHeavy},
  metricLabel:{color:colors.textMuted,fontSize:typography.meta,fontWeight:typography.weightMedium},
  helperText:{color:colors.textMuted,fontSize:typography.meta,lineHeight:typography.metaLine},
});
