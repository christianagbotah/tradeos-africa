import {useCallback,useEffect,useState} from "react";
import {Modal,StyleSheet,Text,View} from "react-native";
import type {MobileOwnCashShiftStatus} from "../api-client";
import {cashShiftConfirmationValid,ownShiftCashExpected,parseCashShiftMinor,formatCashShiftMinor} from "../cash-shift-model";
import {Banner} from "../components/Banner";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {colors,radius,spacing,typography} from "../theme";

export type PosCashShiftPanelProps={
  businessId:string;branchId:string;currencyCode:string;online:boolean;
  getStatus:(businessId:string,branchId:string)=>Promise<MobileOwnCashShiftStatus>;
  submit:(status:MobileOwnCashShiftStatus,countedMinor:number,note:string)=>Promise<void>;
};

/** Restricted to own cash counts, no business wide balances and no manager controls. */
export function PosCashShiftPanel({
  businessId,branchId,currencyCode,online,getStatus,submit,
}:PosCashShiftPanelProps){
  const [status,setStatus]=useState<MobileOwnCashShiftStatus|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [cash,setCash]=useState("");
  const [note,setNote]=useState("");
  const [confirm,setConfirm]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const reload=useCallback(()=>setRefresh(old=>old+1),[]);
  useEffect(()=>{
    setStatus(null);setCash("");setNote("");setConfirm(false);
    setError(null);setNotice(null);
  },[businessId,branchId]);
  useEffect(()=>{
    let active=true;
    if(!online){
      setStatus(null);
      setLoading(false);
      return()=>{active=false;};
    }
    setLoading(true);
    void getStatus(businessId,branchId).then(value=>{
      if(active)setStatus(value);
    }).catch(reason=>{
      if(active)setError(reason instanceof Error?reason.message:"Cash shift could not be refreshed.");
    }).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[businessId,branchId,online,getStatus,refresh]);

  const countedMinor=parseCashShiftMinor(cash,currencyCode);
  const valid=cashShiftConfirmationValid(status,countedMinor,online);
  const closing=Boolean(status?.shift);
  const expected=ownShiftCashExpected(status);
  const difference=countedMinor!==null&&expected!==null ? countedMinor-expected:null;

  const confirmSubmission=async()=>{
    if(busy||!valid||!status||countedMinor===null)return;
    setBusy(true);setError(null);setNotice(null);
    try{
      await submit(status,countedMinor,note);
      setNotice(closing?"Cash count confirmed. Hand over the cash to your supervisor.":
        "Your cash drawer is open. Cash sales are now attributed to your own shift.");
      setCash("");setNote("");setConfirm(false);
      reload();
    }catch(reason){
      setConfirm(false);
      setError(reason instanceof Error?reason.message:
        "The server has NOT confirmed your shift change. Review and sync before retrying.");
    }finally{setBusy(false);}
  };

  return (
    <Card padding="default" accessibilityLabel="My cash shift">
      <View style={styles.heading}>
        <View style={styles.flex}>
          <Text style={styles.title}>My cash shift</Text>
          <Text style={styles.hint}>
            {loading?"Checking your shift…":
              status?.shift?"Your own cash drawer is open":
              status?.operatingDay?"Trading day open · count your starting cash":
              "Ask a supervisor to open the trading day first"}
          </Text>
        </View>
        <Button variant="secondary" size="compact" accessibilityLabel="Refresh cash shift"
          disabled={busy} onPress={reload}>Refresh</Button>
      </View>
      {!online?<Banner tone="warning" title="Online verification required"
        message="Cash shift opening and closing must be confirmed by the server. Offline sales remain separately queued."/>:null}
      {error?<Banner tone="danger" title="Cash shift not confirmed" message={error}/>:null}
      {notice?<Banner tone="success" title="Shift recorded" message={notice}/>:null}
      {status?.operatingDay && online ?(
        <View style={styles.form}>
          {closing&&expected!==null ? (
            <View style={styles.amountRow}>
              <Text style={styles.hint}>Expected cash in my drawer</Text>
              <Text style={styles.amount}>{formatCashShiftMinor(expected,currencyCode)}</Text>
            </View>
          ):null}
          <Input label={closing?"Physical cash counted at handover":"Opening cash float"}
            value={cash} onChangeText={value=>{setCash(value);setNotice(null);}}
            keyboardType="decimal-pad" placeholder="0.00"
            hint="Count your notes and coins; enter 0 explicitly if empty."
            error={cash.trim()!=="" && countedMinor===null?
              "Enter a valid cash amount with the correct decimal places.":null}/>
          {difference!==null?(
            <View style={styles.amountRow}>
              <Text style={styles.hint}>Difference from expected</Text>
              <Text style={[styles.amount,{color:difference<0?colors.danger:
                difference>0?colors.positive:colors.textStrong}]}>
                {formatCashShiftMinor(difference,currencyCode)}
              </Text>
            </View>
          ):null}
          <Input label="Handover note (optional)" value={note}
            onChangeText={setNote} multiline maxLength={1000}
            numberOfLines={2} placeholder="Cash count explanation or supervisor handover"/>
          <Text style={styles.hint}>
            Cash only. MoMo, card and bank are not available to this role.
            Your supervisor controls the day closing and financial reporting.
          </Text>
          <Button variant={closing?"danger":"primary"} fullWidth
            accessibilityLabel={closing?"Review my cash shift close":"Open my cash shift"}
            disabled={!valid||busy||loading} onPress={()=>closing?setConfirm(true):void confirmSubmission()}>
            {closing?"Review & close my cash shift":"Open my cash shift"}
          </Button>
        </View>
      ):null}
      <Modal transparent visible={confirm} animationType="fade"
        onRequestClose={()=>{if(!busy)setConfirm(false);}}>
        <View style={styles.backdrop}>
          <Card style={styles.dialog} padding="comfortable">
            <Text style={styles.title}>Confirm my shift handover</Text>
            <Text style={styles.hint}>Confirm the physical counted cash.
              A shortage or surplus remains visible in the audited shift report;
              it is not automatically balanced by an adjustment.</Text>
            <Text style={styles.amount}>{countedMinor===null?"—":
              formatCashShiftMinor(countedMinor,currencyCode)}</Text>
            <View style={styles.actions}>
              <Button variant="secondary" accessibilityLabel="Cancel shift close"
                disabled={busy} onPress={()=>setConfirm(false)}>Cancel</Button>
              <Button variant="danger" accessibilityLabel="Confirm my cash shift close"
                loading={busy} disabled={!valid} onPress={()=>void confirmSubmission()}>
                Confirm close
              </Button>
            </View>
          </Card>
        </View>
      </Modal>
    </Card>
  );
}
const styles=StyleSheet.create({
  heading:{flexDirection:"row",alignItems:"center",gap:spacing.s3},
  flex:{flex:1},
  title:{fontSize:typography.section,fontWeight:typography.weightBold,color:colors.textStrong},
  hint:{fontSize:typography.supporting,color:colors.textMuted,lineHeight:typography.supportingLine},
  amount:{fontSize:typography.section,fontWeight:typography.weightHeavy,color:colors.textStrong},
  amountRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:spacing.s2},
  form:{marginTop:spacing.s4,gap:spacing.s3},
  backdrop:{flex:1,backgroundColor:colors.overlay,alignItems:"center",justifyContent:"center",padding:spacing.s4},
  dialog:{width:"100%",maxWidth:440,borderRadius:radius.lg,gap:spacing.s4},
  actions:{flexDirection:"row",flexWrap:"wrap",justifyContent:"flex-end",gap:spacing.s2},
});
