import {useEffect,useRef,useState} from "react";
import {ActivityIndicator,Pressable,Text,View,StyleSheet} from "react-native";
import {Directory,File,Paths} from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import type {MobileApiClient} from "../api-client";
import {pdfFileName,pdfPapers,type PdfPaper} from "../pdf-delivery";
import {Icon} from "../components/icons";
import {Banner} from "../components/Banner";
import {colors,radius,spacing,touch,typography} from "../theme";
type Props={api:Pick<MobileApiClient,"downloadDocumentPdf">;kind:"receipt"|"document";businessId:string;branchId:string;id:string;online:boolean;disabled?:boolean};
export function PdfDeliveryPanel({api,kind,businessId,branchId,id,online,disabled=false}:Props){
 const [paper,setPaper]=useState<PdfPaper>(kind==="receipt"?"80mm":"A5"),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const lock=useRef(false),alive=useRef(true),generation=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;++generation.current;};},[businessId,branchId,id,online]);
 async function deliver(action:"print"|"share"){
  if(!online||disabled||lock.current)return;
  lock.current=true;const token=++generation.current;setBusy(true);setError(null);
  let folder:Directory|null=null,handedOff=false;
  try{
   if(action==="share"&&!await Sharing.isAvailableAsync())throw new Error("File sharing is unavailable on this device.");
   const bytes=await api.downloadDocumentPdf(kind,businessId,branchId,id,paper);
   if(!alive.current||token!==generation.current)return;
   const root=new Directory(Paths.cache,"tradeos-private-pdf");root.create({idempotent:true,intermediates:true});
   // Leave a handed-off file accessible to the receiving application; remove old temporary copies on subsequent use.
   for(const entry of root.list()){try{if(entry instanceof Directory){const updated=entry.info().modificationTime;if(typeof updated==="number"&&Date.now()-updated>86_400_000)entry.delete();}}catch{/* Cache cleanup must not block delivery. */}}
   folder=new Directory(root,Crypto.randomUUID());folder.create();
   const file=new File(folder,pdfFileName(kind,id,paper));file.create();file.write(bytes);
   if(!alive.current||token!==generation.current)return;
   if(action==="print")await Print.printAsync({uri:file.uri});
   else await Sharing.shareAsync(file.uri,{mimeType:"application/pdf",UTI:"com.adobe.pdf",dialogTitle:"Share TradeOS PDF"});
   handedOff=true;
  }catch{if(alive.current)setError("Could not prepare or open the verified PDF. Check your connection and device print/share support.");}
  finally{if(folder&&!handedOff){try{folder.delete();}catch{/* OS cache may already be cleared. */}}lock.current=false;if(alive.current)setBusy(false);}
 }
 const unavailable=busy||!online||disabled;
 return <View style={styles.section}>
  <Text accessibilityRole="header" style={styles.heading}>Receipt / document PDF</Text>
  <View style={styles.row} accessibilityLabel="Paper size">{pdfPapers.map(p=><Pressable key={p} accessibilityRole="button" accessibilityLabel={p+" paper"} accessibilityState={{selected:paper===p,disabled:busy||disabled}} disabled={busy||disabled} onPress={()=>setPaper(p)} style={[styles.paper,paper===p&&styles.paperActive]}><Text style={styles.paperLabel}>{p}</Text></Pressable>)}</View>
  <View style={styles.row}>
   <Pressable accessibilityRole="button" accessibilityLabel="Print PDF" accessibilityState={{disabled:unavailable,busy}} disabled={unavailable} onPress={()=>void deliver("print")} style={[styles.action,unavailable&&styles.disabled]}><Icon name="print" size={20}/><Text style={styles.actionLabel}>Print</Text></Pressable>
   <Pressable accessibilityRole="button" accessibilityLabel="Share PDF file" accessibilityState={{disabled:unavailable,busy}} disabled={unavailable} onPress={()=>void deliver("share")} style={[styles.action,styles.share,unavailable&&styles.disabled]}><Icon name="share" size={20}/><Text style={styles.actionLabel}>Share PDF</Text></Pressable>
  </View>
  {busy?<View style={styles.progress} accessibilityRole="progressbar"><ActivityIndicator color={colors.midnight}/><Text style={styles.muted}>Preparing PDF…</Text></View>:null}
  {error?<Banner tone="warning" message={error}/>:null}
  <Text style={styles.muted}>{!online?"Connect to print or share the PDF.":"Select your paper size. Sharing sends the actual PDF file."}</Text>
 </View>;
}
const styles=StyleSheet.create({
 section:{gap:spacing.s2},row:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},
 heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},
 muted:{fontSize:typography.meta,color:colors.textMuted,lineHeight:typography.metaLine},
 paper:{minHeight:touch.iconTarget,paddingHorizontal:spacing.s3,paddingVertical:spacing.s2,justifyContent:"center",borderRadius:radius.sm,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
 paperActive:{backgroundColor:colors.goldSoft,borderColor:colors.gold},
 paperLabel:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},
 action:{flexGrow:1,flexBasis:105,minHeight:touch.minTarget,padding:spacing.s2,flexDirection:"row",flexWrap:"wrap",alignItems:"center",justifyContent:"center",gap:spacing.s2,borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,backgroundColor:colors.surface},
 share:{backgroundColor:colors.goldSoft,borderColor:colors.gold},disabled:{opacity:0.5},
 actionLabel:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.midnight},
 progress:{flexDirection:"row",alignItems:"center",gap:spacing.s2},
});
