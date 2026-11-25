import {useEffect,useRef,useState} from "react";
import {Text,View,StyleSheet} from "react-native";
import {Directory,File,Paths} from "expo-file-system";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Crypto from "expo-crypto";
import type {MobileApiClient} from "../api-client";
import {pdfFileName,pdfPapers,type PdfPaper} from "../pdf-delivery";
import {Button} from "../components/Button";
import {Banner} from "../components/Banner";
import {colors,spacing,typography} from "../theme";
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
 return <View style={styles.section}><Text style={styles.heading}>Print or share PDF</Text><View style={styles.row}>{pdfPapers.map(p=><Button key={p} size="compact" variant={paper===p?"gold":"secondary"} disabled={busy||disabled} accessibilityLabel={p+" paper"} onPress={()=>setPaper(p)}>{p}</Button>)}</View>
 <View style={styles.row}><Button style={styles.flex} variant="secondary" loading={busy} disabled={!online||disabled} accessibilityLabel="Print PDF" onPress={()=>void deliver("print")}>Print PDF</Button><Button style={styles.flex} variant="gold" loading={busy} disabled={!online||disabled} accessibilityLabel="Share PDF file" onPress={()=>void deliver("share")}>Share PDF</Button></View>
 {error?<Banner tone="warning" message={error}/>:null}<Text style={styles.muted}>Choose the matching printer paper size. Sharing sends the actual PDF file, not receipt text.</Text></View>;
}
const styles=StyleSheet.create({section:{gap:spacing.s2},row:{flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},flex:{flex:1},heading:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted}});
