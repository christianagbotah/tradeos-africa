export type StockLocation="AVAILABLE"|"QUARANTINE"|"DAMAGED"|"WASTE";
export type StockAdjustment={itemId:string;quantity:number;sourceLocation?:StockLocation;destinationLocation?:StockLocation;reasonCode:"COUNT_CORRECTION"|"QUARANTINE"|"DAMAGE"|"WASTE"|"OTHER";note:string};
export const stockLocations:readonly StockLocation[]=["AVAILABLE","QUARANTINE","DAMAGED","WASTE"];
export function buildStockAdjustment(itemId:string,quantity:string,source:StockLocation|"NONE",destination:StockLocation|"NONE",note:string):StockAdjustment{
  const n=Number(quantity);
  if(!itemId||!/^\d+(?:\.\d{1,8})?$/.test(quantity.trim())||!Number.isFinite(n)||n<=0||n>1e6)throw new Error("Enter a positive stock quantity.");
  if(source===destination||(!stockLocations.includes(source as StockLocation)&&source!=="NONE")||(!stockLocations.includes(destination as StockLocation)&&destination!=="NONE"))throw new Error("Choose different source and destination locations.");
  if(!note.trim()||note.trim().length>1000)throw new Error("Enter a reason note of up to 1000 characters.");
  const reasonCode=source==="NONE"||destination==="NONE"?"COUNT_CORRECTION":destination==="QUARANTINE"?"QUARANTINE":destination==="DAMAGED"?"DAMAGE":destination==="WASTE"?"WASTE":"OTHER";
  return {itemId,quantity:n,...(source==="NONE"?{}:{sourceLocation:source}),...(destination==="NONE"?{}:{destinationLocation:destination}),reasonCode,note:note.trim()};
}
