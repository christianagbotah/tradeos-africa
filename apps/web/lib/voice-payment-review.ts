import type {VoiceCheckoutSuggestion} from "./voice-transaction-draft";

/**
 * A merchant's spoken amount is NOT proof of payment.
 * This helper only decides whether checkout may offer a manual prefill button.
 */
export function evaluateVoicePaymentSuggestion(input:{
  suggestion:VoiceCheckoutSuggestion|null|undefined;
  paymentMethod:string;
  online:boolean;
  pricingVerified:boolean;
  hubtelSelected:boolean;
  totalMinor:number;
  activeCustomer:boolean;
  availableCreditMinor:number|null;
}):{action:"SPLIT_CASH"|"CASH_RECEIVED"|null;message:string}{
  const {suggestion,paymentMethod,online,pricingVerified,hubtelSelected,totalMinor,
    activeCustomer,availableCreditMinor}=input;
  if(!suggestion)return {action:null,message:""};
  if(suggestion.paymentState==="CREDIT")return {action:null,
    message:"Credit was mentioned. Confirm the customer's eligibility and amount in checkout."};
  if(!Number.isSafeInteger(suggestion.tenderedMinor)||
    suggestion.tenderedMinor===null||suggestion.tenderedMinor<=0)return {
      action:null,
      message:"The spoken payment amount was not clear. Enter the actual amount manually.",
    };
  if(!online||!pricingVerified)return {action:null,
    message:"Spoken amounts can only be prefilled after an online price check."};
  if(hubtelSelected||paymentMethod!=="CASH")return {action:null,
    message:"Verify bank, card or MoMo receipts outside voice recognition. It never confirms electronic payment."};
  if(!Number.isSafeInteger(totalMinor)||totalMinor<=0)return {action:null,
    message:"Review the cart total before recording a payment amount."};
  if(suggestion.paymentState==="PARTIAL"){
    if(!activeCustomer||availableCreditMinor===null)return {action:null,
      message:"A part-payment on credit requires a linked customer and an established credit limit."};
    if(suggestion.tenderedMinor>=totalMinor)return {action:null,
      message:"The spoken part-payment is not below the checkout total. Review the amount."};
    if(totalMinor-suggestion.tenderedMinor>availableCreditMinor)return {action:null,
      message:"Insufficient customer credit for the balance. Review the split manually."};
    return {action:"SPLIT_CASH",message:
      "This will suggest cash received and a remaining customer-credit balance; confirm before charging."};
  }
  if(suggestion.tenderedMinor<totalMinor)return {action:null,
    message:"The spoken cash amount is below the total. Check whether this is a part-payment."};
  return {action:"CASH_RECEIVED",message:
    "Review the physical cash received before completing checkout."};
}
