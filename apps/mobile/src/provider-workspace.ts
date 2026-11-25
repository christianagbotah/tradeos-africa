export type ProviderEnvironment="TEST"|"LIVE";
export type ProviderField={id:string;label:string;required:boolean;secret:boolean;hint?:string};
export type PaymentSchema={providerCode:string;fields:ProviderField[];canVerifyConnection:boolean;verificationRequiresLiveKey:boolean};
export type PaymentConnection={providerCode:string;environment:ProviderEnvironment;accountReference:string|null;status:"SAVED_UNVERIFIED"|"VERIFIED"|"REVOKED";revision:number;collectionEnabled:false;verifiedAt:string|null;activationRequestedAt:string|null};
export type PaymentVault={businessId:string;vaultReady:boolean;schemas:PaymentSchema[];connections:PaymentConnection[];collectionEnabled:false;notice:string};
export type GatewayOptions={businessId:string;preferredProvider:string|null;effectiveLegacyProvider:string|null;revision:number;collectionReady:boolean;providers:{code:string;eligible:boolean}[];notice:string};
export const smsProviders=[{code:"HUBTEL_SMS",name:"Hubtel SMS",accountLabel:"SMS Client ID",secretLabel:"SMS Client Secret",senderLabel:"Approved sender ID"},{code:"ARKESEL",name:"Arkesel",accountLabel:null,secretLabel:"SMS API key",senderLabel:"Approved sender ID"},{code:"NALO",name:"Nalo Solutions",accountLabel:null,secretLabel:"SMS API key",senderLabel:"Approved sender ID"},{code:"TWILIO",name:"Twilio",accountLabel:"Account SID",secretLabel:"Auth Token",senderLabel:"Sender phone (E.164)"}] as const;
export type SmsProvider=typeof smsProviders[number]["code"];
export type SmsConnection={providerCode:SmsProvider;accountId:string|null;senderId:string;status:"SAVED_UNVERIFIED"|"REVOKED";revision:number;enabled:false;updatedAt:string};
export type SmsVault={businessId:string;vaultReady:boolean;sendingEnabled:false;connections:SmsConnection[];notice:string};
export type ProviderAction="save"|"verify"|"request"|"revoke";
export const canManageProviders=(role:string)=>role==="OWNER"||role==="ADMIN";
export function assertVaultScope<T extends {businessId:string}>(value:T,businessId:string):T{if(value.businessId!==businessId)throw new Error("Provider scope mismatch.");return value;}
export function paymentActionAllowed(action:ProviderAction,vault:PaymentVault,schema:PaymentSchema,environment:ProviderEnvironment,current:PaymentConnection|undefined){
 if(!vault.vaultReady||vault.collectionEnabled!==false)return false;
 if(action==="save")return true;
 if(!current||current.status==="REVOKED")return false;
 if(action==="revoke")return true;
 if(action==="verify")return schema.canVerifyConnection&&(!schema.verificationRequiresLiveKey||environment==="LIVE")&&current.status==="SAVED_UNVERIFIED";
 return environment==="LIVE"&&current.status==="VERIFIED"&&!current.activationRequestedAt;
}
export function paymentFields(schema:PaymentSchema,values:Record<string,string>){
 const fields:Record<string,string>={};
 for(const f of schema.fields){const v=(values[f.id]??"").trim();if(f.required&&!v)throw new Error("Complete all required credential fields.");if(v){if(v.length>512||/[^\x20-\x7e]/.test(v))throw new Error("A credential field is invalid.");fields[f.id]=v;}}
 return fields;
}
export function smsFields(provider:SmsProvider,secret:string,sender:string,account:string){
 if(secret.length<8||secret.length>256||/[\r\n]/.test(secret))throw new Error("Enter a valid API secret.");
 const senderId=sender.trim(),accountId=account.trim();
 if(provider==="TWILIO"){if(!/^\+[1-9][0-9]{7,14}$/.test(senderId)||!/^AC[a-fA-F0-9]{32}$/.test(accountId))throw new Error("Check the Twilio sender number and Account SID.");}
 else if(!/^[A-Za-z0-9]{1,11}$/.test(senderId))throw new Error("Sender ID must contain 1–11 letters or digits.");
 if(provider==="HUBTEL_SMS"&&(!accountId||accountId.length>128||/[\r\n]/.test(accountId)))throw new Error("Enter the Hubtel SMS Client ID.");
 return {apiSecret:secret,senderId,accountId:provider==="TWILIO"||provider==="HUBTEL_SMS"?accountId:null};
}
