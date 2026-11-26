/** Provider discovery is not merchant onboarding or authority to move money.
 * Coverage is conservatively based on provider merchant-country/currency docs,
 * not on the cardholder's home country or the provider's marketing reach.
 */
export type GatewayCode =
  "HUBTEL" | "PAYSTACK" | "FLUTTERWAVE" | "STRIPE" |
  "PESAPAL" | "DPO" | "MPESA";
export type GatewayMethod = "MOMO" | "CARD" | "BANK" | "QR";
export type Gateway = {
  code:GatewayCode;name:string;region:string;description:string;
  methods:readonly GatewayMethod[];docsUrl:string;integrationStage:"EXISTING_GATED"|"PLANNED";
  markets: Readonly<Record<string,readonly string[]>>;
};
const EURO = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE",
  "GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK",
  "SI","ES"];
const euroMarkets = Object.fromEntries(EURO.map(code=>[code,["EUR"]])) as Record<string,string[]>;
export const GATEWAYS:readonly Gateway[] = [
  {code:"HUBTEL",name:"Hubtel",region:"Ghana",methods:["MOMO","CARD"],
    description:"Mobile money and hosted bank-card checkout for Ghanaian merchants",
    docsUrl:"https://code.hubtel.com/",integrationStage:"EXISTING_GATED",
    markets:{GH:["GHS"]}},
  {code:"PAYSTACK",name:"Paystack",region:"West, East & Southern Africa",
    methods:["MOMO","CARD","BANK"],
    description:"Cards, mobile money and bank payments where merchant accounts are supported",
    docsUrl:"https://paystack.com/docs/",integrationStage:"PLANNED",
    markets:{GH:["GHS"],NG:["NGN"],KE:["KES"],ZA:["ZAR"]}},
  {code:"FLUTTERWAVE",name:"Flutterwave",region:"Africa and selected international markets",
    methods:["MOMO","CARD","BANK"],
    description:"Hosted payments with local mobile wallets, cards and supported banking methods",
    docsUrl:"https://developer.flutterwave.com/docs/coverage",integrationStage:"PLANNED",
    markets:{GH:["GHS"],NG:["NGN"],KE:["KES"],ZA:["ZAR"],UG:["UGX"],
      TZ:["TZS"],RW:["RWF"],ZM:["ZMW"],MW:["MWK"],EG:["EGP"],
      CI:["XOF"],SN:["XOF"],CM:["XAF"],GB:["GBP"],US:["USD"],...euroMarkets}},
  {code:"STRIPE",name:"Stripe",region:"Europe and eligible global markets",
    methods:["CARD","BANK"],
    description:"Hosted card and eligible local bank methods for supported merchant countries",
    docsUrl:"https://stripe.com/global",integrationStage:"PLANNED",
    markets:{...euroMarkets,GB:["GBP"],US:["USD"],CA:["CAD"],
      CZ:["CZK"],DK:["DKK"],HU:["HUF"],PL:["PLN"],RO:["RON"],
      SE:["SEK"],NO:["NOK"],CH:["CHF"]}},
  {code:"PESAPAL",name:"Pesapal",region:"East & Southern Africa",
    methods:["MOMO","CARD"],
    description:"Regional mobile money and card payments, subject to merchant approval",
    docsUrl:"https://www.pesapal.com/",integrationStage:"PLANNED",
    markets:{KE:["KES"],UG:["UGX"],TZ:["TZS"],RW:["RWF"],
      ZM:["ZMW"],MW:["MWK"],ZW:["USD"]}},
  {code:"DPO",name:"DPO Pay",region:"Multiple African markets",
    methods:["MOMO","CARD"],
    description:"Multi-country African merchant collection subject to local currency approval",
    docsUrl:"https://dpogroup.com/",integrationStage:"PLANNED",
    markets:{GH:["GHS"],KE:["KES"],UG:["UGX"],TZ:["TZS"],RW:["RWF"],
      ZM:["ZMW"],ZA:["ZAR"],NG:["NGN"],BW:["BWP"],NA:["NAD"]}},
  {code:"MPESA",name:"M-Pesa (direct)",region:"Kenya (Safaricom)",
    methods:["MOMO"],
    description:"Direct M-Pesa operator connection, pending operator merchant approval",
    docsUrl:"https://developer.safaricom.co.ke/",integrationStage:"PLANNED",
    markets:{KE:["KES"]}},
];
export function gatewayFor(code:unknown):Gateway|null{
  return GATEWAYS.find(x=>x.code===code)??null;
}
export function gatewaySupported(gateway:Gateway,country:string,currency:string):boolean{
  return gateway.markets[country.toUpperCase()]?.includes(currency.toUpperCase())===true;
}
export function availableGateways(country:string,currency:string){
  const c=country.toUpperCase();
  return GATEWAYS.map(x=>({
    code:x.code,name:x.name,region:x.region,description:x.description,
    methods:x.code==="PAYSTACK"?
      (c==="GH"||c==="KE"?["MOMO","CARD"]:["CARD","BANK"]):
      x.code==="FLUTTERWAVE"?
      (c==="NG"||c==="ZA"||c==="GB"||c==="US"||
        EURO.includes(c)?["CARD","BANK"]:["MOMO","CARD"]):
      [...x.methods],
    docsUrl:x.docsUrl,integrationStage:x.integrationStage,
    eligible:gatewaySupported(x,country,currency),
    notice:gatewaySupported(x,country,currency)?
      "Merchant onboarding and provider verification are still required.":
      "Merchant country/currency is not currently listed for this provider.",
  }));
}
