import {purchasableUnits,type CatalogItem} from "./catalog-read-model";

/** Price is deliberately nullable: zero is valid only after explicitly entered. */
export interface PurchaseOrderDraftLine {
  key:string;
  itemId:string;
  purchaseUnitCode:string;
  quantity:string;
  unitCostMinor:number|null;
}

export function selectPurchaseOrderItem<T extends PurchaseOrderDraftLine>(
  line:T,itemId:string,unitCode:string,
):T {
  if(line.itemId===itemId&&line.purchaseUnitCode===unitCode)return line;
  return {...line,itemId,purchaseUnitCode:unitCode,quantity:"1",unitCostMinor:null};
}

export function selectPurchaseOrderUnit<T extends PurchaseOrderDraftLine>(
  line:T,purchaseUnitCode:string,
):T {
  return line.purchaseUnitCode===purchaseUnitCode?line:
    {...line,purchaseUnitCode,unitCostMinor:null};
}

export function selectPurchaseOrderSupplier<T extends PurchaseOrderDraftLine>(
  lines:readonly T[],previousSupplierId:string,nextSupplierId:string,
):T[] {
  if(previousSupplierId===nextSupplierId)return [...lines];
  return lines.map(line=>({...line,unitCostMinor:null}));
}

export function purchaseOrderCostMissing(lines:readonly PurchaseOrderDraftLine[]):number[]{
  return lines.flatMap((line,i)=>line.itemId&&line.unitCostMinor===null?[i+1]:[]);
}

export function validatePurchaseOrderLines(
  lines:readonly PurchaseOrderDraftLine[],items:readonly CatalogItem[],
):boolean {
  if(lines.length<1||lines.length>50)return false;
  if(new Set(lines.map(line=>line.itemId)).size!==lines.length)return false;
  const byId=new Map(items.map(item=>[item.id,item]));
  let total=0;
  return lines.every(line=>{
    const item=byId.get(line.itemId);
    if(!item||!item.active||item.kind!=="PRODUCT"||!item.trackStock||
      !purchasableUnits(item).some(unit=>unit.code===line.purchaseUnitCode))return false;
    if(!line.quantity.trim())return false;
    const quantity=Number(line.quantity);
    if(!Number.isFinite(quantity)||quantity<=0||quantity>1_000_000||
      Math.abs(quantity*1e8-Math.round(quantity*1e8))>.001)return false;
    const cost=line.unitCostMinor;
    if(cost===null||!Number.isSafeInteger(cost)||cost<0)return false;
    const lineTotal=Math.round(quantity*cost);
    if(!Number.isSafeInteger(lineTotal))return false;
    total+=lineTotal;
    return Number.isSafeInteger(total);
  });
}
