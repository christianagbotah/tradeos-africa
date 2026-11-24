import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./Button";
import { Icon, type IconName } from "./icons";
import { colors, radius, shadows, spacing, typography } from "../theme";
import type { MobileActionFeedback } from "../action-feedback";

const palette: Record<MobileActionFeedback["tone"],{icon:IconName;fg:string;bg:string}> = {
  success:{icon:"check",fg:colors.positive,bg:colors.positiveSoft},
  warning:{icon:"warning",fg:colors.warning,bg:colors.warningSoft},
  danger:{icon:"error",fg:colors.danger,bg:colors.dangerSoft},
  info:{icon:"info",fg:colors.info,bg:colors.infoSoft},
};

export function ActionDialog({feedback,onDismiss,onConfirm}:{
  feedback:MobileActionFeedback|null;
  onDismiss:()=>void;
  onConfirm?:()=>void;
}){
  if(!feedback)return null;
  const tone=palette[feedback.tone];
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaProvider>
      <SafeAreaView edges={["top","bottom","left","right"]} style={styles.backdrop}>
        <View style={styles.dialog} accessibilityViewIsModal>
          <ScrollView bounces={false} contentContainerStyle={styles.content}>
            <View style={[styles.icon,{backgroundColor:tone.bg}]}><Icon name={tone.icon} color={tone.fg} size={32}/></View>
            <Text style={styles.kicker}>TRADEOS AFRICA</Text>
            <Text accessibilityRole="header" style={styles.title}>{feedback.title}</Text>
            <Text accessibilityRole="alert" style={styles.message}>{feedback.message}</Text>
            <View style={styles.actions}>
              {feedback.confirmLabel&&onConfirm?<Button fullWidth variant="secondary" accessibilityLabel="Keep working" onPress={onDismiss}>Keep working</Button>:null}
              <Button fullWidth variant={feedback.confirmLabel?"danger":"primary"}
                accessibilityLabel={feedback.confirmLabel??"Done"} onPress={feedback.confirmLabel&&onConfirm?onConfirm:onDismiss}>
                {feedback.confirmLabel??"Done"}
              </Button>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles=StyleSheet.create({
  backdrop:{flex:1,backgroundColor:colors.overlay,alignItems:"center",justifyContent:"center",padding:spacing.s5},
  dialog:{width:"100%",maxWidth:420,maxHeight:"85%",backgroundColor:colors.surface,borderRadius:radius.lg,...shadows.floating},
  content:{padding:spacing.s6,gap:spacing.s3},
  icon:{width:60,height:60,borderRadius:radius.md,alignItems:"center",justifyContent:"center"},
  kicker:{fontSize:typography.meta,color:colors.goldStrong,fontWeight:typography.weightHeavy,letterSpacing:typography.kickerTracking},
  title:{fontSize:typography.section,lineHeight:typography.sectionLine,fontWeight:typography.weightHeavy,color:colors.textStrong},
  message:{fontSize:typography.body,lineHeight:typography.bodyLine,color:colors.textMuted},
  actions:{gap:spacing.s2,marginTop:spacing.s3},
});
