import {useEffect,useRef,useState} from "react";
import {AppState,Linking,Platform,Text,View,StyleSheet} from "react-native";
import {getSharedAndroidUpdate,installedUpdateBuild,canOfferUpdate,sameAndroidUpdate,type AndroidUpdate} from "../app-updates";
import {Button} from "./Button";
import {Banner} from "./Banner";
import {Card} from "./Card";
import {colors,spacing,typography} from "../theme";
const build=installedUpdateBuild(process.env.EXPO_PUBLIC_TRADEOS_UPDATE_BUILD);
type Props={online:boolean;cart:number;pending:number;failed:number;blocked:number;busy:boolean;canDownload:()=>Promise<boolean>;manual?:boolean};
export function AndroidUpdatePanel({online,cart,pending,failed,blocked,busy,canDownload,manual=false}:Props){
 const [update,setUpdate]=useState<AndroidUpdate|null>(null),[dismissed,setDismissed]=useState<number|null>(null),[checking,setChecking]=useState(false),[message,setMessage]=useState("");
 const live=useRef(true),lock=useRef(false),last=useRef(0);
 const eligible=Platform.OS==="android"&&build!==null;
 const safe=canOfferUpdate(online,cart,pending,busy,failed,blocked);
 const downloading=useRef(false);
 const [opening,setOpening]=useState(false);
 async function check(force=false){
  if(!eligible||build===null||!online||lock.current||(!force&&Date.now()-last.current<3600000))return;
  lock.current=true;setChecking(true);setMessage("");
  try{const result=await getSharedAndroidUpdate(build,force);last.current=Date.now();if(live.current){setUpdate(result);if(!result)setMessage("No newer update-channel build found.");}}
  catch{last.current=0;if(live.current){setUpdate(null);setMessage("Could not check for updates. Try again later.");}}
  finally{lock.current=false;if(live.current)setChecking(false);}
 }
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{if(online&&eligible)void check();const sub=AppState.addEventListener("change",s=>{if(s==="active")void check();});return()=>sub.remove();},[online,eligible]);
 async function download(){
  if(!safe||!update||downloading.current||lock.current||build===null)return;
  downloading.current=true;setOpening(true);setMessage("");
  try{
   // Refresh provenance and re-check the durable queue immediately before the
   // browser handoff; rendering alone is not a transaction-safety guarantee.
   const latest=await getSharedAndroidUpdate(build,true);
   if(!live.current)return;
   setUpdate(latest);
   if(!latest||!sameAndroidUpdate(latest,update)){setMessage("Available update changed. Review it before downloading.");return;}
   if(!await canDownload()){setMessage("Resolve all pending and rejected transactions before downloading.");return;}
   if(live.current)await Linking.openURL(latest.url);
  }catch{if(live.current)setMessage("Could not verify or open the official update. Try again later.");}
  finally{downloading.current=false;if(live.current)setOpening(false);}
 }
 if(!manual&&(!eligible||!update||dismissed===update.build||!safe))return null;
 if(Platform.OS!=="android")return manual?<Card><Text>Updates are managed by your platform's app distribution channel.</Text></Card>:null;
 return <Card style={styles.section}><Text style={styles.heading}>{update?"TradeOS update available":"Application updates"}</Text>
 {!eligible?<Text style={styles.muted}>This testing APK is not enrolled in the persistent-signing update channel. A signed update-channel build is required for in-place updates.</Text>:<>
 <Text style={styles.muted}>Installed build {build}{update?" · Available build "+update.build:""}</Text>
 {update?<><Text style={styles.muted}>Download the official Android package ({(update.size/1048576).toFixed(1)} MB). Android will verify the signing key and ask you to confirm installation.</Text>
 {!safe?<Banner tone="warning" message="Finish the cart, synchronize pending transactions across businesses and resolve rejected records before installing."/>:null}
 <Button variant="gold" loading={opening} disabled={!safe||opening||checking} accessibilityLabel="Download Android update" onPress={()=>{void download();}}>Download &amp; install</Button>
 {!manual?<Button variant="secondary" accessibilityLabel="Remind me later" onPress={()=>setDismissed(update.build)}>Later</Button>:null}</>:null}
 {manual?<Button variant="secondary" loading={checking} disabled={!online||checking||opening} accessibilityLabel="Check for updates" onPress={()=>{setDismissed(null);void check(true);}}>Check for updates</Button>:null}
 {message?<Text style={styles.muted}>{message}</Text>:null}</>}
 </Card>;
}
const styles=StyleSheet.create({section:{gap:spacing.s2},heading:{fontSize:typography.body,fontWeight:typography.weightBold,color:colors.textStrong},muted:{fontSize:typography.meta,color:colors.textMuted}});
