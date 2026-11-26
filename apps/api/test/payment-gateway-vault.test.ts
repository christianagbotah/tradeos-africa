import {afterEach,describe,expect,it} from "vitest";
import {isGatewayVaultConfigured,sealTestGatewayKey,unsealTestGatewayKey}
  from "../src/payment-providers/vault.js";

const name="TRADEOS_GATEWAY_CREDENTIAL_MASTER_KEY_BASE64";
const previous=process.env[name];
afterEach(()=>{if(previous===undefined)delete process.env[name];else process.env[name]=previous;});
const a="00000000-0000-4000-8000-000000000001";
const b="00000000-0000-4000-8000-000000000002";
describe("merchant-owned authenticated encryption",()=>{
  it("fails closed when master key is unavailable",()=>{
    delete process.env[name];
    expect(isGatewayVaultConfigured()).toBe(false);
    expect(()=>sealTestGatewayKey(a,"PAYSTACK","synthetic-secret"))
      .toThrowError("Secure gateway credential storage is not yet configured.");
  });
  it("encrypts uniquely with per-business/provider AEAD and rejects tampering",()=>{
    process.env[name]=Buffer.alloc(32,42).toString("base64");
    expect(isGatewayVaultConfigured()).toBe(true);
    const one=sealTestGatewayKey(a,"PAYSTACK","synthetic-test-secret");
    const two=sealTestGatewayKey(a,"PAYSTACK","synthetic-test-secret");
    expect(one.encrypted.equals(Buffer.from("synthetic-test-secret"))).toBe(false);
    expect(one.nonce.equals(two.nonce)).toBe(false);
    expect(unsealTestGatewayKey(a,"PAYSTACK",one)).toBe("synthetic-test-secret");
    expect(()=>unsealTestGatewayKey(b,"PAYSTACK",one))
      .toThrowError("Stored merchant credential cannot be decrypted.");
    expect(()=>unsealTestGatewayKey(a,"FLUTTERWAVE",one))
      .toThrowError("Stored merchant credential cannot be decrypted.");
    const changed={...one,encrypted:Buffer.from(one.encrypted)};
    changed.encrypted[0]^=1;
    expect(()=>unsealTestGatewayKey(a,"PAYSTACK",changed))
      .toThrowError("Stored merchant credential cannot be decrypted.");
  });
});
