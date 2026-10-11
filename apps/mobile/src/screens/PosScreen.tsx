import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState, LoadingRow } from "../components/EmptyState";
import { Icon } from "../components/icons";
import { Input } from "../components/Input";
import { WorkspaceHeader } from "../components/WorkspaceHeader";
import { colors, radius, spacing, touch, typography } from "../theme";
import type {
  MobileAppSnapshot,
  MobileSaleNotice,
} from "../app-model";
import type {
  MobileCartLine,
  MobileImmediatePaymentMethod,
  MobileSellableItem,
} from "../pos-model";
import { commerceFreshness, formatMoney, formatQuantity } from "../lib/format";

const PAYMENT_METHODS: ReadonlyArray<{ value: MobileImmediatePaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "MoMo" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank" },
  { value: "OTHER", label: "Other" },
];

const SALE_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "SALES", "STAFF"]);

export type PosScreenProps = {
  snapshot: MobileAppSnapshot;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onAdd: (item: MobileSellableItem) => void;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onPayment: (method: MobileImmediatePaymentMethod) => void;
  onCheckout: () => void;
};

export function PosScreen({
  snapshot,
  search,
  onSearch,
  onRefresh,
  onAdd,
  onQuantity,
  onRemove,
  onPayment,
  onCheckout,
}: PosScreenProps) {
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const currencyCode = ready.business.currencyCode;
  const canSell = SALE_ROLES.has(ready.membership.role);
  const items = snapshot.commerce?.items ?? [];
  const visibleItems = filterItems(items, search);
  const total = items.length === 0 && snapshot.cart.length > 0
    ? snapshot.cart.reduce((sum, line) => sum + Math.round(line.priceMinor * line.quantity), 0)
    : cartTotal(snapshot.cart);

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <WorkspaceHeader
        online={snapshot.online}
        syncing={snapshot.syncing}
        failedCount={ready.queue.failed}
        pendingCount={ready.queue.pending}
      />

      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <Text style={styles.kicker}>Fast sale</Text>
          <Text style={styles.sectionTitle}>Catalog</Text>
          <Text style={styles.sectionCopy}>{commerceFreshness(snapshot)}</Text>
        </View>
        <Button
          variant="secondary"
          size="compact"
          disabled={snapshot.commerceLoading}
          loading={snapshot.commerceLoading}
          accessibilityLabel="Refresh catalog"
          onPress={onRefresh}
        >
          Refresh
        </Button>
      </View>

      {snapshot.commerce?.warning ? (
        <Banner tone="warning" message={snapshot.commerce.warning} title="Catalog notice" />
      ) : null}
      {snapshot.error ? <Banner tone="danger" message={snapshot.error} title="Action failed" /> : null}

      <Input
        label="Find an item"
        value={search}
        onChangeText={onSearch}
        placeholder="Search item, SKU or unit"
        autoCapitalize="none"
        autoCorrect={false}
        leftAdornment={<Icon name="search" size={16} color={colors.textSoft} />}
        returnKeyType="search"
      />

      {!snapshot.commerce && snapshot.commerceLoading ? (
        <Card padding="compact">
          <LoadingRow label="Loading this branch catalog…" hint="Pulling sellable items and stock." />
        </Card>
      ) : null}

      {snapshot.commerce && visibleItems.length === 0 ? (
        <Card padding="comfortable">
          <EmptyState
            kind="empty"
            icon="catalog"
            title="No matching sellable items"
            description="Try a different search, or refresh to pull the latest catalog from the server."
            actionLabel={search ? "Clear search" : undefined}
            onAction={search ? () => onSearch("") : undefined}
          />
        </Card>
      ) : null}

      <View style={styles.catalogList}>
        {visibleItems.map((item) => (
          <CatalogCard
            key={item.key}
            item={item}
            currencyCode={currencyCode}
            onAdd={() => onAdd(item)}
          />
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.kicker}>Current sale</Text>
          <Text style={styles.sectionTitle}>Cart · {snapshot.cart.length}</Text>
        </View>
        {snapshot.cart.length > 0 ? (
          <Text style={styles.displayTotal}>{formatMoney(total, currencyCode)}</Text>
        ) : null}
      </View>

      {snapshot.cart.length === 0 ? (
        <Card padding="comfortable">
          <EmptyState
            kind="empty"
            icon="cart"
            title="Cart is empty"
            description="Tap + Add on a catalog unit above to begin a sale."
          />
        </Card>
      ) : (
        <Card padding="none" variant="raised">
          {snapshot.cart.map((line, index) => (
            <CartRow
              key={line.key}
              line={line}
              currencyCode={currencyCode}
              isLast={index === snapshot.cart.length - 1}
              onQuantity={onQuantity}
              onRemove={onRemove}
            />
          ))}
          <View style={styles.totalRow}>
            <View style={styles.flex}>
              <Text style={styles.totalLabel}>Display total</Text>
              <Text style={styles.totalHint}>Server recalculates final price</Text>
            </View>
            <Text style={styles.totalValue}>{formatMoney(total, currencyCode)}</Text>
          </View>
        </Card>
      )}

      <Card padding="default" style={styles.paymentCard}>
        <Text style={styles.kicker}>Payment</Text>
        <Text style={styles.paymentTitle}>How is the customer paying?</Text>
        <View style={styles.paymentGrid}>
          {PAYMENT_METHODS.map((method) => {
            const active = snapshot.paymentMethod === method.value;
            return (
              <Pressable
                key={method.value}
                accessibilityRole="button"
                accessibilityLabel={`Select ${method.label} payment`}
                accessibilityState={{ selected: active }}
                onPress={() => onPayment(method.value)}
                style={({ pressed }) => [
                  styles.paymentChip,
                  active && styles.paymentChipActive,
                  pressed && styles.paymentChipPressed,
                ]}
              >
                <Text style={[styles.paymentChipText, active && styles.paymentChipTextActive]}>
                  {method.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {!canSell ? (
          <Banner
            tone="warning"
            message="Your role can browse this catalog but does not have permission to create sales."
            title="Role permission"
          />
        ) : null}

        {snapshot.saleNotice ? (
          <SaleNoticeBanner notice={snapshot.saleNotice} />
        ) : null}

        <Button
          variant="gold"
          fullWidth
          disabled={!canSell || snapshot.cart.length === 0 || snapshot.checkoutBusy}
          loading={snapshot.checkoutBusy}
          accessibilityLabel="Charge sale"
          onPress={onCheckout}
        >
          {snapshot.checkoutBusy ? "Saving sale…" : `Charge · ${formatMoney(total, currencyCode)}`}
        </Button>

        <Text style={styles.checkoutHint}>
          {snapshot.online === false
            ? "Offline: the sale will be saved on this device and synchronized later."
            : "TradeOS saves locally first, then synchronizes with the server."}
        </Text>
      </Card>
    </ScrollView>
  );
}

function CatalogCard({
  item,
  currencyCode,
  onAdd,
}: {
  item: MobileSellableItem;
  currencyCode: string;
  onAdd: () => void;
}) {
  const stockText = item.trackStock
    ? item.availableStock === null
      ? "Stock not cached"
      : `${formatQuantity(item.availableStock)} ${item.stockUnitCode ?? "stock"} last known`
    : "No stock tracking";
  return (
    <Card padding="compact" style={styles.catalogCard}>
      <View style={styles.catalogMain}>
        <Text style={styles.catalogName} numberOfLines={2}>{item.name}</Text>
        <Text style={styles.catalogMeta} numberOfLines={1}>
          {item.sku ? `${item.sku} · ` : ""}{item.unitLabel}
        </Text>
        <Text style={styles.stockText} numberOfLines={1}>{stockText}</Text>
      </View>
      <View style={styles.catalogAction}>
        <Text style={styles.catalogPrice} numberOfLines={1}>
          {formatMoney(item.priceMinor, currencyCode)}
        </Text>
        <Button
          variant="secondary"
          size="compact"
          accessibilityLabel={`Add ${item.name} to cart`}
          onPress={onAdd}
        >
          + Add
        </Button>
      </View>
    </Card>
  );
}

function CartRow({
  line,
  currencyCode,
  isLast,
  onQuantity,
  onRemove,
}: {
  line: MobileCartLine;
  currencyCode: string;
  isLast: boolean;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
}) {
  const decrease = () =>
    line.quantity <= 1 ? onRemove(line.key) : onQuantity(line.key, line.quantity - 1);
  return (
    <View style={[styles.cartRow, isLast && styles.cartRowLast]}>
      <View style={styles.cartInfo}>
        <Text style={styles.cartName} numberOfLines={2}>{line.name}</Text>
        <Text style={styles.cartMeta} numberOfLines={1}>
          {line.unitLabel} · {formatMoney(line.priceMinor, currencyCode)}
        </Text>
      </View>
      <View style={styles.quantityControl}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${line.name} quantity`}
          onPress={decrease}
          style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
        >
          <Text style={styles.quantityButtonText}>−</Text>
        </Pressable>
        <Text style={styles.quantityValue}>{formatQuantity(line.quantity)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${line.name} quantity`}
          onPress={() => onQuantity(line.key, line.quantity + 1)}
          style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
        >
          <Text style={styles.quantityButtonText}>+</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.name} from cart`}
        onPress={() => onRemove(line.key)}
        style={({ pressed }) => [styles.removeButton, pressed && styles.removePressed]}
      >
        <Text style={styles.removeButtonText}>×</Text>
      </Pressable>
    </View>
  );
}

function SaleNoticeBanner({ notice }: { notice: MobileSaleNotice }) {
  const tone = notice.tone === "success" ? "success"
    : notice.tone === "pending" ? "warning"
    : "danger";
  return <Banner tone={tone} message={notice.message} title="Sale result" />;
}

function cartTotal(cart: ReadonlyArray<MobileCartLine>): number {
  return cart.reduce((sum, line) => sum + Math.round(line.priceMinor * line.quantity), 0);
}

function filterItems(items: ReadonlyArray<MobileSellableItem>, query: string): MobileSellableItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...items];
  return items.filter((item) =>
    [item.name, item.sku ?? "", item.unitLabel, item.unitCode]
      .some((value) => value.toLocaleLowerCase().includes(normalized)),
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s6 + 4,
    gap: spacing.s4,
  },
  flex: { flex: 1 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: spacing.s3,
  },
  kicker: {
    color: colors.goldStrong,
    fontSize: typography.meta,
    fontWeight: typography.weightBlack,
    letterSpacing: typography.kickerTracking,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.textStrong,
    fontSize: typography.section,
    fontWeight: typography.weightBlack,
    lineHeight: typography.sectionLine,
    marginTop: 2,
  },
  sectionCopy: {
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
    marginTop: 2,
  },
  catalogList: {
    gap: spacing.s2 + 2,
  },
  catalogCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s3,
  },
  catalogMain: {
    flex: 1,
    gap: 3,
  },
  catalogName: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  catalogMeta: {
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
  },
  stockText: {
    color: colors.textSoft,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
    fontWeight: typography.weightBold,
  },
  catalogAction: {
    alignItems: "flex-end",
    gap: spacing.s2,
  },
  catalogPrice: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  displayTotal: {
    color: colors.textStrong,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  cartRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s2 + 2,
    padding: spacing.s3,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cartRowLast: {
    borderBottomWidth: 0,
  },
  cartInfo: {
    flex: 1,
    gap: 2,
  },
  cartName: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  cartMeta: {
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
  },
  quantityControl: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.s1 + 2,
  },
  quantityButton: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  quantityPressed: {
    backgroundColor: colors.border,
  },
  quantityButtonText: {
    color: colors.textStrong,
    fontSize: typography.body + 1,
    fontWeight: typography.weightBlack,
  },
  quantityValue: {
    minWidth: 30,
    textAlign: "center",
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  removeButton: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  removePressed: {
    backgroundColor: colors.dangerBorder,
  },
  removeButtonText: {
    color: colors.danger,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  totalRow: {
    flexDirection: "row",
    gap: spacing.s3,
    alignItems: "center",
    padding: spacing.s4,
    backgroundColor: colors.surfaceSoft,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: {
    color: colors.textStrong,
    fontSize: typography.supporting,
    fontWeight: typography.weightBlack,
  },
  totalHint: {
    color: colors.textMuted,
    fontSize: typography.meta,
    marginTop: 2,
  },
  totalValue: {
    color: colors.textStrong,
    fontSize: typography.body + 2,
    fontWeight: typography.weightBlack,
    letterSpacing: -0.2,
  },
  paymentCard: {
    gap: spacing.s3,
  },
  paymentTitle: {
    color: colors.textStrong,
    fontSize: typography.body,
    fontWeight: typography.weightBlack,
  },
  paymentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.s2,
  },
  paymentChip: {
    minHeight: touch.compactTarget,
    minWidth: 72,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.s3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  paymentChipActive: {
    backgroundColor: colors.midnight,
    borderColor: colors.midnight,
  },
  paymentChipPressed: {
    opacity: 0.7,
  },
  paymentChipText: {
    color: colors.textMuted,
    fontSize: typography.meta,
    fontWeight: typography.weightBold,
  },
  paymentChipTextActive: {
    color: colors.textInverse,
  },
  checkoutHint: {
    color: colors.textMuted,
    fontSize: typography.meta,
    lineHeight: typography.metaLine,
    textAlign: "center",
  },
});
