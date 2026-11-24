import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "./icons";
import { SyncBadge, deriveSyncStatus } from "./SyncBadge";
import { colors, radius, spacing, typography, touch } from "../theme";

export type WorkspaceHeaderProps = {
  businessName:string;branchName:string;userName:string;title:string;
  online:boolean|null;syncing:boolean;failedCount:number;pendingCount?:number;
  onMenu:()=>void;attendantOnly?:boolean;
};

/** Fixed white merchant chrome, matching the web portal's business/branch
 * context and profile control. Screen content scrolls below this header. */
export function WorkspaceHeader({businessName,branchName,userName,title,online,syncing,failedCount,pendingCount=0,onMenu,attendantOnly=false}:WorkspaceHeaderProps){
  const status=deriveSyncStatus({online,syncing,failed:failedCount});
  const initials=userName.trim().split(/\s+/).slice(0,2).map(part=>part[0]?.toUpperCase()??"").join("")||"T";
  return <View style={styles.header} accessibilityRole="header">
    <View style={styles.mainRow}>
      <View style={styles.mark}><Text style={styles.markText}>T</Text></View>
      <View style={styles.context}>
        <Text style={styles.business} numberOfLines={1}>{businessName}</Text>
        <Text style={styles.branch} numberOfLines={1}>{branchName} · {title}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={attendantOnly?"Sign out of POS":"Open account and more tools"}
        onPress={onMenu} style={({pressed})=>[styles.profile,pressed&&styles.pressed]}>
        {attendantOnly?<Icon name="logout" size={20} color={colors.textStrong}/>:<Text style={styles.initials}>{initials}</Text>}
      </Pressable>
    </View>
    <View style={styles.statusRow}>
      <SyncBadge status={status} pendingCount={pendingCount} failedCount={failedCount}/>
    </View>
  </View>;
}
const styles=StyleSheet.create({
  header:{backgroundColor:colors.surface,borderBottomWidth:1,borderBottomColor:colors.border,paddingHorizontal:spacing.s3,paddingVertical:spacing.s2,gap:spacing.s1},
  mainRow:{minHeight:touch.minTarget,flexDirection:"row",alignItems:"center",gap:spacing.s3},
  mark:{width:36,height:36,borderRadius:radius.sm,alignItems:"center",justifyContent:"center",backgroundColor:colors.gold},
  markText:{fontSize:20,fontWeight:typography.weightBlack,color:colors.midnight},
  context:{flex:1,minWidth:0,gap:2},
  business:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong},
  branch:{fontSize:typography.meta,color:colors.textMuted},
  profile:{width:touch.minTarget,height:touch.minTarget,borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,alignItems:"center",justifyContent:"center",backgroundColor:colors.surfaceSoft},
  initials:{fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.midnight},
  statusRow:{flexDirection:"row",justifyContent:"flex-start",paddingLeft:48},
  pressed:{opacity:0.65},
});
