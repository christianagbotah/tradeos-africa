import {describe,expect,it} from "vitest";
import {matchingTestReturn,readGatewayTestHandoff} from "./gateway-test-handoff";
const id="123e4567-e89b-42d3-a456-426614174000";
const url=`?section=payments&test_attempt=${id}&test_ref=TSP_TEST1&test_tx=9876`;
const attempt={attemptId:id,clientReference:"TSP_TEST1",providerCode:"FLUTTERWAVE",
  environment:"TEST" as const,state:"PREPARED"};
describe("sandbox return hints are tenant-attempt-matched before filling verification",()=>{
  it("prefills only the matching open Flutterwave TEST attempt",()=>{
    expect(matchingTestReturn([attempt],readGatewayTestHandoff(url)!))
      .toEqual({match:attempt,prefill:"9876"});
  });
  it("rejects mismatched references, closed attempts and browser conflict markers",()=>{
    const hint=readGatewayTestHandoff(url)!;
    expect(matchingTestReturn([{...attempt,clientReference:"different"}],hint).match).toBeNull();
    expect(matchingTestReturn([{...attempt,state:"REVIEW_REQUIRED"}],hint).match).toBeNull();
    expect(matchingTestReturn([attempt],{...hint,referenceConflict:true}).prefill).toBeNull();
    expect(matchingTestReturn([{...attempt,providerCode:"PAYSTACK"}],hint).prefill).toBeNull();
  });
  it("accepts no malformed or duplicate untrusted IDs",()=>{
    expect(readGatewayTestHandoff("?test_attempt=BAD&test_ref=TSP_TEST1")).toBeNull();
    expect(readGatewayTestHandoff(url+`&test_attempt=${id}`)).toBeNull();
    expect(readGatewayTestHandoff(url.replace("9876","abc"))?.transactionId).toBeNull();
  });
});
