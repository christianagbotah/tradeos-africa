import {describe,expect,it} from "vitest";
import {readSandboxReturn,sandboxSettingsUrl} from "./return-context";
const id="123e4567-e89b-42d3-a456-426614174000";
const basic=`?attempt=${id}&expected_ref=TSP_20261119_1234`;
describe("untrusted TEST checkout return handoff",()=>{
  it("keeps a valid Flutterwave numeric ID as an optional, unverified UI hint",()=>{
    const parsed=readSandboxReturn(basic+"&status=successful&tx_ref=TSP_20261119_1234&transaction_id=45231");
    expect(parsed).toMatchObject({attemptId:id,transactionId:"45231",
      referenceConflict:false,providerStatus:"successful"});
    const url=sandboxSettingsUrl(parsed!);
    expect(url).toContain("section=payments");
    expect(url).toContain("test_tx=45231");
    expect(url).not.toContain("status=successful");
  });
  it("handles Paystack reference handoff without inventing a transaction ID",()=>{
    const parsed=readSandboxReturn(basic+"&reference=TSP_20261119_1234&trxref=TSP_20261119_1234");
    expect(parsed?.transactionId).toBeNull();
    expect(parsed?.referenceConflict).toBe(false);
  });
  it("blocks malformed IDs, duplicates and conflicting references from prefill",()=>{
    expect(readSandboxReturn("?attempt=bad&expected_ref=ABCD")).toBeNull();
    expect(readSandboxReturn(basic+"&attempt="+id)).toBeNull();
    const parsed=readSandboxReturn(basic+"&tx_ref=other_ref&transaction_id=45231");
    expect(parsed?.referenceConflict).toBe(true);
    expect(sandboxSettingsUrl(parsed!)).not.toContain("test_tx=");
    expect(sandboxSettingsUrl(parsed!)).toContain("test_ref_conflict=1");
    expect(readSandboxReturn(basic+"&transaction_id=4%0A5")?.transactionId).toBeNull();
  });
});
