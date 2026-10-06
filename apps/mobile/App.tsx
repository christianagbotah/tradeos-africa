import { StatusBar } from "expo-status-bar";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { defaultPlatformProfile } from "@tradeos/client-core";

const profile = defaultPlatformProfile("ANDROID");

const packs = [
  "Retail & Hardware",
  "Food & Waakye",
  "Salon & Barber",
  "Drinks & Spots",
  "Washing Bay",
  "Car Park",
];

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.brandRow}>
          <View style={styles.mark}><Text style={styles.markText}>T</Text></View>
          <View>
            <Text style={styles.brand}>TradeOS Africa</Text>
            <Text style={styles.muted}>Android + iOS shared client</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Offline-first business operating system</Text>
          <Text style={styles.title}>Sell, serve and record work even when the network is down.</Text>
          <Text style={styles.body}>
            This mobile shell will use the same tenant, catalog, transaction and sync contracts as the web and desktop clients.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mobile capabilities</Text>
          <Text style={styles.body}>{Array.from(profile.capabilities).join(" · ")}</Text>
        </View>

        <Text style={styles.sectionTitle}>Business packs</Text>
        <View style={styles.packGrid}>
          {packs.map((pack) => (
            <Pressable key={pack} style={styles.packCard}>
              <Text style={styles.packText}>{pack}</Text>
              <Text style={styles.muted}>Shared core · tailored workflow</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f3f6fa" },
  container: { padding: 20, gap: 18 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  mark: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center" },
  markText: { color: "white", fontSize: 20, fontWeight: "900" },
  brand: { color: "#0f172a", fontSize: 20, fontWeight: "800" },
  hero: { backgroundColor: "white", borderRadius: 22, padding: 22, gap: 9 },
  eyebrow: { color: "#168a4b", fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { color: "#0f172a", fontSize: 28, lineHeight: 34, fontWeight: "800" },
  body: { color: "#5b6b80", fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: "#0f172a", borderRadius: 18, padding: 18, gap: 7 },
  cardTitle: { color: "white", fontSize: 16, fontWeight: "800" },
  sectionTitle: { color: "#0f172a", fontSize: 17, fontWeight: "800" },
  packGrid: { gap: 10 },
  packCard: { backgroundColor: "white", padding: 17, borderRadius: 16, gap: 5 },
  packText: { color: "#0f172a", fontSize: 15, fontWeight: "800" },
  muted: { color: "#7c8ba0", fontSize: 12 },
});
