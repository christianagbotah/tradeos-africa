import {describe,it,expect} from "vitest";
import {canManageProviders,assertVaultScope,paymentActionAllowed,paymentFields,smsFields,type PaymentVault,type PaymentSchema,type PaymentConnection} from "./provider-workspace";
const schema:PaymentSchema={providerCode:"HUBTEL",fields:[{id:"apiId",label:"API ID",secret:false,required:true},{id:"apiKey",label:"API key",secret:true,required:true}],canVerifyConnection:true,verificationRequiresLiveKey:true};
const vault={businessId:"b",vaultReady:true,collectionEnabled:false,schemas:[schema],connections:[],notice:""} as PaymentVault;
const connection={providerCode:"HUBTEL",environment:"LIVE",status:"SAVED_UNVERIFIED",revision:1,collectionEnabled:false,verifiedAt:null,activationRequestedAt:null} as PaymentConnection;
describe("provider settings",()=>{
 it("restricts vault access and enforces business scope",()=>{
  expect(canManageProviders("OWNER")).toBe(true);expect(canManageProviders("ADMIN")).toBe(true);expect(canManageProviders("MANAGER")).toBe(false);
  expect(()=>assertVaultScope(vault,"other")).toThrow();
 });
 it("requires verified live credentials before requesting activation",()=>{
  expect(paymentActionAllowed("verify",vault,schema,"TEST",connection)).toBe(false);
  expect(paymentActionAllowed("verify",vault,schema,"LIVE",connection)).toBe(true);
  expect(paymentActionAllowed("request",vault,schema,"LIVE",connection)).toBe(false);
  expect(paymentActionAllowed("request",vault,schema,"LIVE",{...connection,status:"VERIFIED"})).toBe(true);
  expect(paymentActionAllowed("request",vault,schema,"TEST",{...connection,status:"VERIFIED"})).toBe(false);
  expect(paymentActionAllowed("save",{...vault,vaultReady:false},schema,"LIVE",undefined)).toBe(false);
 });
 it("only sends declared credential fields",()=>{
  expect(paymentFields(schema,{apiId:"identifier",apiKey:"sample-value",unexpected:"ignored"})).toEqual({apiId:"identifier",apiKey:"sample-value"});
  expect(()=>paymentFields(schema,{apiId:"identifier"})).toThrow();
 });
 it("validates SMS sender and account formats",()=>{
  expect(smsFields("ARKESEL","example-key","TradeOS","ignored").accountId).toBeNull();
  expect(()=>smsFields("HUBTEL_SMS","example-key","TradeOS","")).toThrow();
  expect(()=>smsFields("TWILIO","example-key","TradeOS","AC"+"a".repeat(32))).toThrow();
 });
});
