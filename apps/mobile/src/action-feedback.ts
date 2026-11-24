import type { MobileSaleNotice } from "./app-model";

export type MobileActionFeedback={
  tone:"success"|"warning"|"danger"|"info";
  title:string;
  message:string;
  confirmLabel?:string;
};

export function saleActionFeedback(notice:MobileSaleNotice|null,error:string|null,quickServe:boolean):MobileActionFeedback|null{
  if(error)return {tone:"danger",title:"Sale could not be recorded",message:error};
  if(!notice)return null;
  // The food-vendor mode retains its existing inline feedback for ordinary
  // outcomes, so a cashier does not need an extra tap for every cash sale.
  if(quickServe&&notice.tone!=="review")return null;
  switch(notice.tone){
    case "success":return {tone:"success",title:"Sale completed",message:notice.message};
    case "pending":return {tone:"warning",title:"Saved on this device",message:notice.message};
    case "review":return {tone:"danger",title:"Sale needs review",message:notice.message};
  }
}

export const signOutFeedback:MobileActionFeedback={
  tone:"warning",title:"Sign out of TradeOS?",
  message:"Unsynchronized transactions remain on this device. You can return to this business to sync them.",
  confirmLabel:"Sign out",
};
