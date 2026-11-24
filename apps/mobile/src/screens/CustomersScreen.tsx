import {useCallback,useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from "react-native";
import {MobileApiError,type MobileApiClient,type MobileCustomer,type MobileCustomerDetail} from "../api-client";
import type {MobileActionFeedback} from "../action-feedback";
import {canReadCustomers,canEditCustomer,filterCustomers,confirmedCustomerRows,insertConfirmedCustomer,normalizeCustomerContact,type CustomerContactDraft,type CustomerFilter} from "../customer-directory";
import {Button} from "../components/Button";
import {Card} from "../components/Card";
import {Input} from "../components/Input";
import {Banner} from "../components/Banner";
import {EmptyState} from "../components/EmptyState";
import {Icon} from "../components/icons";
import {formatMoney} from "../lib/format";
import {displaySaleDate} from "../sales-history";
import {colors,radius,spacing,typography} from "../theme";

type Props={api:Pick<MobileApiClient,"getCustomers"|"getCustomer"|"updateCustomerContact"|"createCustomerContact">;businessId:string;role:string;currencyCode:string;timezone:string;online:boolean;onFeedback:(feedback:MobileActionFeedback)=>void};
const FILTERS:readonly {value:CustomerFilter;label:string}[]=[{value:"ALL",label:"All"},{value:"ACTIVE",label:"Active"},{value:"INACTIVE",label:"Inactive"},{value:"OWES",label:"Owes balance"}];

export function CustomersScreen({api,businessId,role,currencyCode,timezone,online,onFeedback}:Props){
  const allowed=canReadCustomers(role),canEdit=canEditCustomer(role);
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<CustomerFilter>("ALL");
  const [rows,setRows]=useState<MobileCustomer[]|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [detail,setDetail]=useState<MobileCustomerDetail|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [detailError,setDetailError]=useState<string|null>(null);
  const [edit,setEdit]=useState<{name:string;phone:string;email:string;expectedUpdatedAt:string}|null>(null);
  const [saving,setSaving]=useState(false);
  const [create,setCreate]=useState<CustomerContactDraft|null>(null);
  const [createError,setCreateError]=useState<string|null>(null);
  const [uncertainCreate,setUncertainCreate]=useState(false);
  const [refreshNonce,setRefreshNonce]=useState(0);
  const sequence=useRef(0),detailSequence=useRef(0),saveLock=useRef(false);
  const reload=useCallback(async()=>{
    const current=++sequence.current;
    setError(null);
    if(!online||!allowed){setRows(null);setLoading(false);return;}
    setLoading(true);
    try{
      const result=await api.getCustomers(businessId,query);
      if(current===sequence.current)setRows(result.customers);
    }catch{
      if(current===sequence.current){setRows(null);setError("Customer directory could not be loaded.");}
    }finally{if(current===sequence.current)setLoading(false);}
  },[api,businessId,query,online,allowed]);
  useEffect(()=>{
    const timer=setTimeout(()=>{void reload();},250);
    return ()=>{clearTimeout(timer);++sequence.current;};
  },[reload,refreshNonce]);
  useEffect(()=>{
    ++detailSequence.current;setSelected(null);setDetail(null);setEdit(null);setCreate(null);setCreateError(null);setUncertainCreate(false);setDetailLoading(false);setDetailError(null);
    return ()=>{++detailSequence.current;};
  },[businessId,online,allowed]);
  async function openCustomer(id:string){
    if(!online||!allowed||saveLock.current||create)return;
    const current=++detailSequence.current;
    setSelected(id);setDetail(null);setEdit(null);setDetailError(null);setDetailLoading(true);
    try{
      const data=await api.getCustomer(businessId,id);
      if(current!==detailSequence.current)return;
      if(data.customer.id!==id)throw new Error("Mismatched customer");
      setDetail(data);
    }catch{if(current===detailSequence.current)setDetailError("Customer details could not be loaded.");}
    finally{if(current===detailSequence.current)setDetailLoading(false);}
  }
  function closeDetail(){if(saveLock.current)return;++detailSequence.current;setSelected(null);setDetail(null);setEdit(null);setDetailLoading(false);setDetailError(null);}
  async function save(){
    if(!detail||!edit||!edit.name.trim()||!canEdit||!online||saveLock.current)return;
    saveLock.current=true;setSaving(true);setDetailError(null);
    const current=detailSequence.current,id=detail.customer.id;
    try{
      const result=await api.updateCustomerContact(businessId,id,{name:edit.name.trim(),phone:edit.phone.trim()||null,email:edit.email.trim()||null,expectedUpdatedAt:edit.expectedUpdatedAt});
      if(current!==detailSequence.current)return;
      if(result.customer.id!==id)throw new Error("Mismatched customer");
      ++sequence.current;
      setDetail(old=>old?{...old,customer:result.customer}:old);
      setRows(old=>old?confirmedCustomerRows(old,result.customer):old);
      setEdit(null);
      onFeedback({tone:"success",title:"Customer updated",message:"Contact details have been saved."});
      void reload();
    }catch(e){
      if(current===detailSequence.current){
        setDetailError(e instanceof MobileApiError&&e.statusCode===409?"Customer changed on another device. Reload the details before editing again.":"Could not confirm the update. Reload the customer before retrying.");
        setEdit(null);
        void reload();
      }
    }finally{saveLock.current=false;setSaving(false);}
  }
  function startCreate(){
    if(!online||!canEdit||saveLock.current)return;
    closeDetail();setCreateError(null);setCreate({name:"",phone:"",email:""});
  }
  async function saveNew(){
    if(!create||!online||!canEdit||saveLock.current||uncertainCreate)return;
    let contact:ReturnType<typeof normalizeCustomerContact>;
    try{contact=normalizeCustomerContact(create);}catch(e){setCreateError(e instanceof Error?e.message:"Check contact details.");return;}
    saveLock.current=true;setSaving(true);setCreateError(null);
    const current=detailSequence.current;
    try{
      const result=await api.createCustomerContact(businessId,contact);
      if(current!==detailSequence.current)return;
      ++sequence.current;
      setQuery("");setFilter("ALL");
      setRows(old=>insertConfirmedCustomer(old??[],result.customer));
      setCreate(null);setUncertainCreate(false);
      // Refresh using the newly reset query, rather than a stale search closure.
      setRefreshNonce(n=>n+1);
      onFeedback({tone:"success",title:"Customer created",message:"The customer has been saved in your business directory."});
    }catch(e){
      if(current!==detailSequence.current)return;
      // A disconnected response may follow a successful server commit. Never
      // automatically re-POST or invite an immediate blind duplicate.
      const rejected=e instanceof MobileApiError&&[400,403,422].includes(e.statusCode);
      setCreateError(rejected?"The server rejected the contact details. Check the form and your permissions.":"Creation could not be confirmed. Check the directory before attempting another creation.");
      if(!rejected){setUncertainCreate(true);setQuery(contact.name);setFilter("ALL");setRefreshNonce(n=>n+1);}
    }finally{saveLock.current=false;setSaving(false);}
  }
  const visible=filterCustomers(rows??[],filter);
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.heading}>
      <View style={styles.flex}><Text style={styles.eyebrow}>Master data</Text><Text style={styles.title}>Customers</Text><Text style={styles.muted}>Manage contacts and outstanding balances.</Text></View>
      {online&&allowed?<Button variant="secondary" size="compact" accessibilityLabel="Refresh customers" onPress={()=>void reload()}>Refresh</Button>:null}
    </View>
    {!allowed?<Banner tone="warning" title="Restricted access" message="Your role cannot view customer accounts."/>:!online?<Banner tone="info" title="Offline" message="Customer accounts require a live connection. Your offline POS remains available."/>:<>
      {canEdit?<Button variant="gold" fullWidth disabled={saving||Boolean(create)} accessibilityLabel="Add customer" onPress={startCreate}>+ Add customer</Button>:null}
      {create?<Card style={styles.section}>
        <Text style={styles.sectionTitle}>New customer</Text>
        <Input label="Customer name" accessibilityLabel="New customer name" value={create.name} maxLength={160} editable={!saving&&!uncertainCreate} onChangeText={name=>setCreate(old=>old?{...old,name}:old)}/>
        <Input label="Phone" value={create.phone} maxLength={40} keyboardType="phone-pad" editable={!saving&&!uncertainCreate} onChangeText={phone=>setCreate(old=>old?{...old,phone}:old)}/>
        <Input label="Email" value={create.email} maxLength={254} keyboardType="email-address" autoCapitalize="none" editable={!saving&&!uncertainCreate} onChangeText={email=>setCreate(old=>old?{...old,email}:old)}/>
        {createError?<Banner tone={uncertainCreate?"warning":"danger"} message={createError}/>:null}
        {uncertainCreate?<Button variant="secondary" fullWidth disabled={loading} accessibilityLabel="Review directory before creating again" onPress={()=>{setCreate(null);setCreateError(null);setUncertainCreate(false);}}>Review directory</Button>:<>
          <Button variant="primary" fullWidth loading={saving} disabled={!create.name.trim()} accessibilityLabel="Create customer" onPress={()=>void saveNew()}>Create customer</Button>
          <Button variant="secondary" fullWidth disabled={saving} accessibilityLabel="Cancel new customer" onPress={()=>{setCreate(null);setCreateError(null);}}>Cancel</Button>
        </>}
      </Card>:null}
      {selected?<Card style={styles.section}>
        <View style={styles.heading}><Text style={[styles.sectionTitle,styles.flex]}>Customer details</Text><Button size="compact" variant="secondary" disabled={saving} accessibilityLabel="Close customer details" onPress={closeDetail}>Close</Button></View>
        {detailLoading?<ActivityIndicator color={colors.goldStrong}/>:null}
        {detailError?<Banner tone="danger" message={detailError}/>:null}
        {detail?<>
          <Text style={styles.sectionTitle}>{detail.customer.name}</Text>
          <Text style={styles.muted}>{detail.customer.phone??"No phone"} · {detail.customer.email??"No email"}</Text>
          <View style={styles.balance}><Text style={styles.muted}>Account balance</Text><Text style={styles.money}>{formatMoney(detail.customer.balanceMinor,currencyCode)}</Text></View>
          {edit?<>
            <Input label="Customer name" value={edit.name} editable={!saving} maxLength={160} onChangeText={name=>setEdit(old=>old?{...old,name}:old)}/>
            <Input label="Phone" value={edit.phone} editable={!saving} maxLength={40} keyboardType="phone-pad" onChangeText={phone=>setEdit(old=>old?{...old,phone}:old)}/>
            <Input label="Email" value={edit.email} editable={!saving} maxLength={254} keyboardType="email-address" autoCapitalize="none" onChangeText={email=>setEdit(old=>old?{...old,email}:old)}/>
            <Button variant="primary" fullWidth loading={saving} disabled={!edit.name.trim()} accessibilityLabel="Save customer details" onPress={()=>void save()}>Save changes</Button>
            <Button variant="secondary" fullWidth disabled={saving} accessibilityLabel="Cancel editing" onPress={()=>setEdit(null)}>Cancel editing</Button>
          </>:canEdit?<Button variant="gold" accessibilityLabel="Edit customer contact" onPress={()=>setEdit({name:detail.customer.name,phone:detail.customer.phone??"",email:detail.customer.email??"",expectedUpdatedAt:detail.customer.updatedAt})}>Edit contact</Button>:null}
          <Button variant="secondary" size="compact" disabled={saving} accessibilityLabel="Reload customer details" onPress={()=>void openCustomer(selected)}>Reload details</Button>
          <Text style={styles.sectionTitle}>Credit obligations</Text>
          {detail.obligations.length===0?<Text style={styles.muted}>No credit obligations.</Text>:detail.obligations.map(item=><View key={item.id} style={styles.row}><View style={styles.flex}><Text style={styles.rowTitle}>Due {displaySaleDate(item.dueAt,timezone)}</Text><Text style={styles.muted}>Original {formatMoney(item.originalMinor,currencyCode)}</Text></View><Text style={styles.rowTitle}>{formatMoney(item.openMinor,currencyCode)}</Text></View>)}
          <Text style={styles.sectionTitle}>Recent account activity</Text>
          {detail.ledger.length===0?<Text style={styles.muted}>No account activity.</Text>:detail.ledger.map(item=><View key={item.id} style={styles.row}><View style={styles.flex}><Text style={styles.rowTitle}>{item.entryType.replaceAll("_"," ")}</Text><Text style={styles.muted}>{displaySaleDate(item.occurredAt,timezone)}</Text></View><Text style={styles.rowTitle}>{formatMoney(item.balanceDeltaMinor,item.currencyCode)}</Text></View>)}
        </>:null}
      </Card>:null}
      <Card style={styles.section}>
        <Input label="Search customers" value={query} onChangeText={setQuery} editable={!saving} placeholder="Name, phone or email" leftAdornment={<Icon name="search" size={18} color={colors.textMuted}/>}/>
        <View style={styles.filters}>{FILTERS.map(item=><Pressable key={item.value} accessibilityRole="button" accessibilityState={{selected:filter===item.value}} onPress={()=>setFilter(item.value)} style={[styles.chip,filter===item.value&&styles.chipActive]}><Text style={[styles.chipText,filter===item.value&&styles.chipTextActive]}>{item.label}</Text></Pressable>)}</View>
        {loading?<ActivityIndicator color={colors.goldStrong}/>:null}
        {error?<Banner tone="danger" message={error}/>:null}
        {rows&&visible.length===0&&!loading?<EmptyState title="No matching customers" description="Try another search or filter."/>:null}
        {visible.map(row=><Pressable key={row.id} disabled={saving||Boolean(create)} accessibilityRole="button" accessibilityLabel={"View customer "+row.name} onPress={()=>void openCustomer(row.id)} style={styles.row}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{row.name.trim().slice(0,1).toUpperCase()}</Text></View>
          <View style={styles.flex}><Text style={styles.rowTitle} numberOfLines={1}>{row.name}</Text><Text style={styles.muted} numberOfLines={1}>{row.phone??row.email??"No contact details"}</Text><Text style={styles.muted}>{row.active?"Active":"Inactive"}</Text></View>
          <View style={styles.amount}><Text style={styles.rowTitle}>{formatMoney(row.balanceMinor,currencyCode)}</Text><Text style={styles.muted}>Balance</Text></View><Icon name="arrowRight" size={16} color={colors.textMuted}/>
        </Pressable>)}
        {rows?.length===200?<Text style={styles.muted}>Showing up to 200 results. Search for a specific customer.</Text>:null}
      </Card>
    </>}
  </ScrollView>;
}
const styles=StyleSheet.create({
  page:{flexGrow:1,backgroundColor:colors.canvas,padding:spacing.s4,gap:spacing.s4,paddingBottom:spacing.s8},
  heading:{flexDirection:"row",alignItems:"center",gap:spacing.s3},flex:{flex:1,minWidth:0},eyebrow:{fontSize:typography.meta,fontWeight:typography.weightBold,color:colors.goldStrong,textTransform:"uppercase",letterSpacing:1},
  title:{fontSize:typography.display,color:colors.textStrong,fontWeight:typography.weightHeavy},muted:{fontSize:typography.meta,lineHeight:typography.metaLine,color:colors.textMuted},
  section:{gap:spacing.s3},sectionTitle:{fontSize:typography.body,fontWeight:typography.weightHeavy,color:colors.textStrong},balance:{backgroundColor:colors.goldSoft,borderRadius:radius.sm,padding:spacing.s3},money:{fontSize:typography.kpi,fontWeight:typography.weightHeavy,color:colors.midnight},
  filters:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},chip:{padding:spacing.s2,borderWidth:1,borderColor:colors.border,borderRadius:radius.pill,minHeight:40,justifyContent:"center"},chipActive:{backgroundColor:colors.goldSoft,borderColor:colors.gold},chipText:{fontSize:typography.meta,color:colors.textMuted,fontWeight:typography.weightMedium},chipTextActive:{color:colors.midnight},
  row:{flexDirection:"row",alignItems:"center",gap:spacing.s2,paddingVertical:spacing.s3,borderBottomWidth:1,borderBottomColor:colors.border},rowTitle:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},avatar:{width:36,height:36,borderRadius:18,backgroundColor:colors.goldSoft,alignItems:"center",justifyContent:"center"},avatarText:{color:colors.goldStrong,fontWeight:typography.weightHeavy},amount:{alignItems:"flex-end",maxWidth:"42%"},
});
