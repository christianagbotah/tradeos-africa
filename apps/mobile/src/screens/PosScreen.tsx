import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Banner } from "../components/Banner";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState, LoadingRow } from "../components/EmptyState";
import { Icon } from "../components/icons";
import { Input } from "../components/Input";
import { colors, radius, spacing, touch, typography } from "../theme";
import { canSubmitMobileSale } from "../app-model";
import type {
  MobileAppSnapshot,
  MobileSaleNotice,
} from "../app-model";
import type {
  MobileCartLine,
  MobileImmediatePaymentMethod,
  MobileSellableItem,
} from "../pos-model";
import { canAddPosItem, displayCartTotalMinor, filterSellableItems, visibleQuickServeGroups, QUICK_SERVE_PAGE_SIZE } from "../pos-model";
import {PdfDeliveryPanel} from "./PdfDeliveryPanel";
import type {MobileApiClient,MobileOwnCashShiftStatus} from "../api-client";
import {PosCashShiftPanel} from "./PosCashShiftPanel";
import { commerceFreshness, formatMoney, formatQuantity } from "../lib/format";

const PAYMENT_METHODS: ReadonlyArray<{ value: MobileImmediatePaymentMethod; label: string }> = [
  { value: "CASH", label: "Cash" },
  { value: "MOMO", label: "MoMo" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank" },
  { value: "OTHER", label: "Other" },
];

const SALE_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "CASHIER", "POS_ATTENDANT", "SALES", "STAFF"]);

export type PosScreenProps = {
  snapshot: MobileAppSnapshot;
  receiptApi?:Pick<MobileApiClient,"downloadDocumentPdf">;
  search: string;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onAdd: (item: MobileSellableItem) => void;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  onPayment: (method: MobileImmediatePaymentMethod) => void;
  onCheckout: (quickServe:boolean) => void;
  getOwnCashShift?: (businessId:string,branchId:string)=>Promise<MobileOwnCashShiftStatus>;
  onOwnCashShift?: (status:MobileOwnCashShiftStatus,countedMinor:number,note:string)=>Promise<void>;
};

export function PosScreen({
  snapshot,
  receiptApi,
  search,
  onSearch,
  onRefresh,
  onAdd,
  onQuantity,
  onRemove,
  onPayment,
  onCheckout,
  getOwnCashShift,
  onOwnCashShift,
 }: PosScreenProps) {
  const [quickServe,setQuickServe] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const cartOffset = useRef<number | null>(null);
  const reviewCart = () => { if (cartOffset.current !== null) scrollRef.current?.scrollTo({ y: cartOffset.current, animated: false }); };
  const [quickLimit,setQuickLimit]=useState(QUICK_SERVE_PAGE_SIZE);
  const catalogScope=snapshot.bootstrap?.status==="READY"?snapshot.bootstrap.business.id+":"+snapshot.bootstrap.branch.id:"";
  useEffect(()=>setQuickLimit(QUICK_SERVE_PAGE_SIZE),[search,catalogScope]);
  const attendantOnly = snapshot.bootstrap?.status === "READY" &&
    snapshot.bootstrap.membership.role === "POS_ATTENDANT";
  useEffect(() => {
    if (attendantOnly && snapshot.paymentMethod !== "CASH") onPayment("CASH");
  }, [attendantOnly, snapshot.paymentMethod, onPayment]);
  if (snapshot.bootstrap?.status !== "READY") return null;
  const ready = snapshot.bootstrap;
  const currencyCode = ready.business.currencyCode;
  const canSell = SALE_ROLES.has(ready.membership.role);
  const items = snapshot.commerce?.items ?? [];
  const visibleItems = filterSellableItems(items, search);
  const quickCatalog=quickServe?visibleQuickServeGroups(visibleItems,quickLimit):null;
  const total = displayCartTotalMinor(snapshot.cart);

  return (
    <View style={styles.page}>
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >

      {receiptApi&&snapshot.saleNotice?.tone==="success"&&snapshot.saleNotice.completedSaleId&&snapshot.online===true?<Card padding="default">
        <Text style={styles.modeLabel}>Last completed sale</Text>
        <PdfDeliveryPanel key={ready.user.id+":"+ready.business.id+":"+ready.branch.id+":"+snapshot.saleNotice.completedSaleId} api={receiptApi} kind="receipt" businessId={ready.business.id} branchId={ready.branch.id} id={snapshot.saleNotice.completedSaleId} online={true} disabled={snapshot.checkoutBusy||snapshot.syncing}/>
      </Card>:null}
      <View style={styles.modeRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Standard POS mode"
          accessibilityState={{selected:!quickServe,disabled:snapshot.checkoutBusy}}
          disabled={snapshot.checkoutBusy}
          style={[styles.modeOption,!quickServe&&styles.modeActive]}
          onPress={()=>setQuickServe(false)}>
          <Text style={[styles.modeLabel,!quickServe&&styles.modeLabelActive]}>Standard POS</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Quick Serve food mode"
          accessibilityState={{selected:quickServe,disabled:snapshot.checkoutBusy}}
          disabled={snapshot.checkoutBusy}
          style={[styles.modeOption,quickServe&&styles.modeActive]}
          onPress={()=>{onPayment("CASH");setQuickServe(true);}}>
          <Text style={[styles.modeLabel,quickServe&&styles.modeLabelActive]}>Quick Serve</Text>
        </Pressable>
      </View>
      {attendantOnly&&getOwnCashShift&&onOwnCashShift?(
        <PosCashShiftPanel
          key={ready.membership.businessId+":"+ready.branch.id}
          businessId={ready.membership.businessId}
          branchId={ready.branch.id}
          currencyCode={currencyCode}
          online={snapshot.online===true}
          getStatus={getOwnCashShift}
          submit={onOwnCashShift}
        />
      ):null}
      {quickServe&&snapshot.saleNotice?<SaleNoticeBanner notice={snapshot.saleNotice}/>:null}
      <View style={styles.sectionHeader}>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>{quickServe?"Portion prices":"Catalog"}</Text>
          <Text style={styles.sectionCopy}>{commerceFreshness(snapshot)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh catalog"
          accessibilityState={{disabled:snapshot.commerceLoading,busy:snapshot.commerceLoading}}
          disabled={snapshot.commerceLoading} onPress={onRefresh}
          style={({pressed})=>[styles.iconAction,pressed&&styles.quantityPressed]}>
          {snapshot.commerceLoading?<ActivityIndicator color={colors.midnight}/>:<Icon name="refresh" size={20} color={colors.midnight}/>}
        </Pressable>
      </View>

      {snapshot.commerce?.warning ? (
        <Banner tone="warning" message={snapshot.commerce.warning} title="Catalog notice" />
      ) : null}
      {snapshot.error ? <Banner tone="danger" message={snapshot.error} title="Action failed" /> : null}

      <Input
        label="Find an item"
        accessibilityLabel="Find an item"
        value={search}
        onChangeText={onSearch}
        placeholder="Search item, SKU or selling unit"
        autoCapitalize="none"
        autoCorrect={false}
        leftAdornment={<Icon name="search" size={16} color={colors.textSoft} />}
        returnKeyType="search"
        rightAdornment={search ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={()=>onSearch("")} style={styles.clearSearch}><Icon name="close" size={20} color={colors.textMuted}/></Pressable> : undefined}
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

      {quickServe?(
        <View style={styles.quickFoodList} accessibilityLabel="Quick Serve food buttons">
          {quickCatalog?.groups.map(group=>(
            <Card key={group.itemId} padding="compact" style={styles.quickFoodCard}>
              <Text style={styles.quickFoodName}>{group.name}</Text>
              <View style={styles.quickPortions}>
                {group.options.map(item=>{
                  const outOfStock=item.trackStock&&item.availableStock!==null&&
                    item.availableStock<=0;
                  const selected=snapshot.cart.find(line=>line.key===item.key)?.quantity??0;
                  const disabled=!canAddPosItem(item,canSell,snapshot.checkoutBusy,true);
                  return <Pressable key={item.key} accessibilityRole="button"
                    accessibilityLabel={"Add "+item.name+", "+item.unitLabel+", "+
                      formatMoney(item.priceMinor,currencyCode)}
                    accessibilityState={{disabled}}
                    disabled={disabled}
                    onPress={()=>onAdd(item)}
                    style={({pressed})=>[styles.quickPortion,
                      pressed&&styles.quickPortionPressed,
                      disabled&&styles.quickDisabled]}>
                    <Text style={styles.quickPrice}>{formatMoney(item.priceMinor,currencyCode)}</Text>
                    <Text style={styles.quickUnit} numberOfLines={2}>{item.unitLabel}</Text>
                    {selected>0?<Text style={styles.quickSelected}>{selected} in cart</Text>:null}
                    {outOfStock?<Text style={styles.quickUnit}>Sold out</Text>:null}
                  </Pressable>;
                })}
              </View>
            </Card>
          ))}
          {quickCatalog?.hasMore?<Button variant="secondary" fullWidth
            accessibilityLabel="Show more Quick Serve products"
            onPress={()=>setQuickLimit(limit=>limit+QUICK_SERVE_PAGE_SIZE)}>
            {`Show more · ${quickCatalog.groups.length} of ${quickCatalog.totalGroups}`}
          </Button>:null}
        </View>
      ):(
      <View style={styles.catalogList}>
        {visibleItems.map((item) => (
          <CatalogCard
            key={item.key}
            item={item}
            currencyCode={currencyCode}
            onAdd={() => onAdd(item)}
            disabled={!canAddPosItem(item,canSell,snapshot.checkoutBusy,false)}
          />
        ))}
      </View>
      )}

      <View style={styles.sectionHeader} onLayout={event=>{cartOffset.current=event.nativeEvent.layout.y;}}>
        <View style={styles.flex}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Cart · {snapshot.cart.length}</Text>
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
            description="Tap + beside a catalog item to begin a sale."
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
              disabled={snapshot.checkoutBusy || !canSell}
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

      {!quickServe?<Card padding="default" style={styles.paymentCard}>
        <Text accessibilityRole="header" style={styles.paymentTitle}>Payment method</Text>
        <View style={styles.paymentGrid}>
          {PAYMENT_METHODS.filter(method=>!attendantOnly || method.value==="CASH").map((method) => {
            const active = snapshot.paymentMethod === method.value;
            return (
              <Pressable
                key={method.value}
                accessibilityRole="button"
                accessibilityLabel={`Select ${method.label} payment`}
                accessibilityState={{ selected: active, disabled: snapshot.checkoutBusy || !canSell }}
                disabled={snapshot.checkoutBusy || !canSell}
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
          disabled={!canSell || !canSubmitMobileSale(snapshot)}
          loading={snapshot.checkoutBusy}
          accessibilityLabel="Charge sale"
          onPress={()=>onCheckout(quickServe)}
        >
          {snapshot.checkoutBusy ? "Saving sale…" : snapshot.syncing ? "Synchronizing…" : `Charge · ${formatMoney(total, currencyCode)}`}
        </Button>

        <Text style={styles.checkoutHint}>
          {snapshot.syncing
            ? "Wait for synchronization to finish. Your current cart is preserved."
            : snapshot.online === false
            ? "Offline: the sale will be saved on this device and synchronized later."
            : "TradeOS saves locally first, then synchronizes with the server."}
        </Text>
      </Card>:(
        <Text style={styles.quickPaymentHint}>
          Cash only. For MoMo or other payments, use Standard POS. Cached totals are estimates until confirmed.
        </Text>
      )}
    </ScrollView>
    {quickServe?(
      <View style={styles.quickSticky} accessibilityLabel="Quick Serve order total and cash collection">
        <View style={styles.quickStickyTotal}>
          <View style={styles.flex}><Text style={styles.quickTotalCaption}>Estimated cash total</Text>
          <Text style={styles.quickTotal}>{formatMoney(total,currencyCode)}</Text></View>
          <Button variant="secondary" accessibilityLabel="Review current cart" disabled={!snapshot.cart.length} onPress={reviewCart}>Cart · {snapshot.cart.length}</Button>
        </View>
        <Button variant="gold" fullWidth
          disabled={!canSell||!canSubmitMobileSale(snapshot)||
            snapshot.paymentMethod!=="CASH"}
          loading={snapshot.checkoutBusy}
          accessibilityLabel="Cash received, record this sale"
          onPress={()=>onCheckout(quickServe)}>
          {snapshot.checkoutBusy?"Saving locally…":snapshot.syncing?"Synchronizing…":"Cash received · Record sale"}
        </Button>
        <Text style={styles.quickStickyNote}>
          {snapshot.syncing?"Wait for synchronization to finish. Your cart is preserved.":"Records locally first. Sync status is shown after each sale."}
        </Text>
      </View>
    ):snapshot.cart.length>0?(
      <View style={styles.quickSticky}>
        <View style={styles.quickStickyTotal}>
          <View style={styles.flex}><Text style={styles.quickTotalCaption}>Estimated total</Text><Text style={styles.quickTotal}>{formatMoney(total,currencyCode)}</Text></View>
          <Button variant="gold" accessibilityLabel="Review current cart" onPress={reviewCart}>Cart · {snapshot.cart.length}</Button>
        </View>
      </View>
    ):null}
    </View>
  );
}

function CatalogCard({
  item,
  currencyCode,
  onAdd,
  disabled,
}: {
  item: MobileSellableItem;
  currencyCode: string;
  onAdd: () => void;
  disabled: boolean;
}) {
  const stockText = item.trackStock
    ? item.availableStock === null
      ? "Stock not cached"
      : `${formatQuantity(item.availableStock)} ${item.stockUnitCode ?? "stock"} last known`
    : "No stock tracking";
  return (
    <Card padding="compact" style={styles.catalogCard}>
      <View style={styles.catalogMain}>
        <Text style={styles.catalogName}>{item.name}</Text>
        <Text style={styles.catalogMeta}>
          {item.sku ? `${item.sku} · ` : ""}{item.unitLabel}
        </Text>
        <Text style={styles.stockText}>{stockText}</Text>
      </View>
      <View style={styles.catalogAction}>
        <Text style={styles.catalogPrice}>
          {formatMoney(item.priceMinor, currencyCode)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Add ${item.name}, ${item.unitLabel} to cart`}
          accessibilityState={{disabled}} disabled={disabled} onPress={onAdd}
          style={({pressed})=>[styles.iconAction,styles.addAction,pressed&&styles.quantityPressed,disabled&&styles.quickDisabled]}>
          <Icon name="plus" size={22} color={colors.midnight}/>
        </Pressable>
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
  disabled,
}: {
  line: MobileCartLine;
  currencyCode: string;
  isLast: boolean;
  onQuantity: (key: string, quantity: number) => void;
  onRemove: (key: string) => void;
  disabled: boolean;
}) {
  const decrease = () =>
    line.quantity <= 1 ? onRemove(line.key) : onQuantity(line.key, line.quantity - 1);
  return (
    <View style={[styles.cartRow, isLast && styles.cartRowLast]}>
      <View style={styles.cartInfo}>
        <Text style={styles.cartName}>{line.name}</Text>
        <Text style={styles.cartMeta}>
          {line.unitLabel} · {formatMoney(line.priceMinor, currencyCode)}
        </Text>
      </View>
      <View style={styles.quantityControl}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${line.name} quantity`}
          accessibilityState={{disabled}}
          disabled={disabled}
          onPress={decrease}
          style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
        >
          <Text style={styles.quantityButtonText}>−</Text>
        </Pressable>
        <Text style={styles.quantityValue}>{formatQuantity(line.quantity)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${line.name} quantity`}
          accessibilityState={{disabled}}
          disabled={disabled}
          onPress={() => onQuantity(line.key, line.quantity + 1)}
          style={({ pressed }) => [styles.quantityButton, pressed && styles.quantityPressed]}
        >
          <Text style={styles.quantityButtonText}>+</Text>
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove ${line.name} from cart`}
        accessibilityState={{disabled}}
          disabled={disabled}
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

const styles = StyleSheet.create({
  page: {flex:1,backgroundColor:colors.canvas},
  scroll: {flex:1},
  modeRow: {flexDirection:"row",gap:spacing.s2},
  modeOption: {flex:1,alignItems:"center",justifyContent:"center",
    borderRadius:radius.sm,borderWidth:1,borderColor:colors.border,
    backgroundColor:colors.surface,minHeight:touch.minTarget,paddingHorizontal:spacing.s2,paddingVertical:spacing.s2},
  modeActive: {backgroundColor:colors.midnight,borderColor:colors.midnight},
  modeLabel: {fontSize:typography.supporting,fontWeight:typography.weightBold,color:colors.textStrong,textAlign:"center"},
  iconAction: {width:touch.minTarget,height:touch.minTarget,borderRadius:radius.sm,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,alignItems:"center",justifyContent:"center"},
  addAction: {backgroundColor:colors.goldSoft,borderColor:colors.goldBorder},
  clearSearch: {width:touch.iconTarget,height:touch.iconTarget,alignItems:"center",justifyContent:"center"},
  modeLabelActive: {color:colors.textInverse},
  quickFoodList: {gap:spacing.s2},
  quickFoodCard: {gap:spacing.s2},
  quickFoodName: {fontSize:typography.body,fontWeight:typography.weightBlack,
    color:colors.textStrong},
  quickPortions: {flexDirection:"row",flexWrap:"wrap",gap:spacing.s2},
  quickPortion: {flexGrow:1,flexBasis:100,minWidth:100,minHeight:touch.minTarget,
    borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,
    backgroundColor:colors.surfaceSoft,alignItems:"flex-start",
    justifyContent:"center",padding:spacing.s2,gap:3},
  quickPortionPressed: {backgroundColor:colors.border},
  quickDisabled: {opacity:0.45},
  quickPrice: {fontSize:typography.body+2,fontWeight:typography.weightBlack,
    color:colors.textStrong},
  quickUnit: {fontSize:typography.meta,color:colors.textMuted},
  quickSelected: {fontSize:typography.meta,fontWeight:typography.weightBold,
    color:colors.goldStrong},
  quickPaymentHint: {fontSize:typography.meta,lineHeight:typography.metaLine,
    color:colors.textMuted},
  quickSticky: {backgroundColor:colors.surface,paddingHorizontal:spacing.s4,
    paddingVertical:spacing.s3,borderTopWidth:1,borderTopColor:colors.border,
    gap:spacing.s2},
  quickStickyTotal: {flexDirection:"row",justifyContent:"space-between",
    alignItems:"center",flexWrap:"wrap",gap:spacing.s2},
  quickTotalCaption: {fontSize:typography.supporting,color:colors.textMuted,
    fontWeight:typography.weightBold},
  quickTotal: {fontSize:typography.section,fontWeight:typography.weightBlack,
    color:colors.textStrong},
  quickStickyNote: {textAlign:"center",fontSize:typography.meta,
    color:colors.textMuted},
  content: {
    paddingTop: spacing.s3,
    flexGrow: 1,
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.s4,
    paddingBottom: spacing.s4,
    gap: spacing.s3,
  },
  flex: { flex: 1, minWidth: 0 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: spacing.s3,
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
    minWidth: 0,
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
    maxWidth: "45%",
    alignItems: "flex-end",
    gap: spacing.s2,
  },
  catalogPrice: {
    textAlign: "right",
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
    flexWrap: "wrap",
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
    flexBasis: 120,
    minWidth: 100,
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
    width: touch.iconTarget,
    height: touch.iconTarget,
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
    width: touch.iconTarget,
    height: touch.iconTarget,
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
    minHeight: touch.minTarget,
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
