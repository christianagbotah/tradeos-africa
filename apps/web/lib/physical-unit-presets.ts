/**
 * Explicit per-SKU physical unit conversion setup for shops.
 * Every factor must be measured/entered by the owner. Never invent a
 * universal box weight, coil length, crate quantity, or piece/tonne ratio.
 */
export const PHYSICAL_UNIT_PRESETS = [
  {id:"NAILS_BOX_POUND",label:"Nails · Box → Pound",from:"box",fromLabel:"Box",to:"pound",toLabel:"Pound",stockUnit:"pound"},
  {id:"SANDPAPER_COIL_YARD",label:"Sandpaper · Coil → Yard",from:"coil",fromLabel:"Coil",to:"yard",toLabel:"Yard",stockUnit:"yard"},
  {id:"DRINKS_CRATE_BOTTLE",label:"Drinks · Crate → Bottle",from:"crate",fromLabel:"Crate",to:"bottle",toLabel:"Bottle",stockUnit:"bottle"},
  {id:"DRINKS_BOTTLE_GLASS",label:"Drinks · Bottle → Glass",from:"bottle",fromLabel:"Bottle",to:"glass",toLabel:"Glass",stockUnit:"bottle"},
  {id:"DRINKS_BOTTLE_SHOT",label:"Spirits · Bottle → Shot",from:"bottle",fromLabel:"Bottle",to:"shot",toLabel:"Shot",stockUnit:"bottle"},
  {id:"PACK_PIECE",label:"Provision · Pack → Piece",from:"pack",fromLabel:"Pack",to:"piece",toLabel:"Piece",stockUnit:"piece"},
  {id:"CEMENT_BAG_KG",label:"Cement · Bag → Kilogram",from:"bag",fromLabel:"Bag",to:"kg",toLabel:"Kilogram",stockUnit:"kg"},
  {id:"ROD_TON_PIECE",label:"Iron rods · Tonne → Piece",from:"tonne",fromLabel:"Tonne",to:"piece",toLabel:"Piece",stockUnit:"piece"},
] as const;
export type PhysicalPresetId=(typeof PHYSICAL_UNIT_PRESETS)[number]["id"];
export interface PhysicalUnit {
  code:string;label:string;canPurchase:boolean;canSell:boolean;
  canStock:boolean;priceMinor:number|null;
}
export interface PhysicalConversion {
  fromUnitCode:string;toUnitCode:string;factor:string;
}
export function parsePhysicalFactor(input:string): number {
  const value=input.trim();
  if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,6})?$/.test(value)) {
    throw new Error("Enter the measured conversion factor, such as 25 or 30.5.");
  }
  const factor=Number(value);
  if (!(factor>0) || !Number.isFinite(factor)) {
    throw new Error("The conversion factor must be greater than zero.");
  }
  return factor;
}
export function addPhysicalUnitPreset<U extends PhysicalUnit,C extends PhysicalConversion>(
  currentUnits:readonly U[],
  currentConversions:readonly C[],
  id:PhysicalPresetId,
  factorText:string,
  options:{kind:"PRODUCT"|"PREPARED_PRODUCT"|"SERVICE";newItem:boolean},
):{units:U[];conversions:C[];addedUnits:number;addedConversion:boolean} {
  if(options.kind!=="PRODUCT") {
    throw new Error("Physical unit conversion templates are for stocked products.");
  }
  const template=PHYSICAL_UNIT_PRESETS.find(p=>p.id===id);
  if(!template) throw new Error("Unknown physical conversion template.");
  const factor=parsePhysicalFactor(factorText);
  let units=currentUnits.map(u=>({...u}));
  let conversions=currentConversions.map(c=>({...c}));
  const placeholder=units.length===1 && currentConversions.length===0 &&
    units[0]?.code==="each" && units[0]?.label==="Each (piece)" &&
    units[0]?.priceMinor===null && units[0]?.canPurchase===true &&
    units[0]?.canStock===true && units[0]?.canSell===true;
  if(options.newItem && placeholder) units=[];
  const existingPair=conversions.find(c=>
    c.fromUnitCode.toLowerCase()===template.from &&
    c.toUnitCode.toLowerCase()===template.to);
  if(existingPair) {
    if (Number(existingPair.factor)!==factor) {
      throw new Error("This conversion already exists with a different factor. Edit the existing row deliberately.");
    }
    return {units,conversions,addedUnits:0,addedConversion:false};
  }
  const countBefore=units.length;
  const ensureUnit=(code:string,label:string)=>{
    if(units.some(u=>u.code.trim().toLowerCase()===code))return;
    if(units.length>=40) throw new Error("Too many units are configured for this item.");
    const stockable=!units.some(u=>u.canStock) && code===template.stockUnit;
    units.push({
      code,label,canPurchase:code===template.from,canSell:true,
      canStock:stockable,priceMinor:null,
    } as U);
  };
  ensureUnit(template.from,template.fromLabel);
  ensureUnit(template.to,template.toLabel);
  if(conversions.length>=40)throw new Error("Too many conversions are configured for this item.");
  conversions.push({
    fromUnitCode:template.from,toUnitCode:template.to,factor:String(factor),
  } as C);
  return {units,conversions,addedUnits:units.length-countBefore,addedConversion:true};
}
