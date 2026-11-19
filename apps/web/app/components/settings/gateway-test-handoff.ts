/** Never use browser query parameters as payment evidence. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF=/^[A-Za-z0-9_-]{4,36}$/;
const TX=/^[1-9][0-9]{0,15}$/;
export type TestHandoff={attemptId:string;reference:string;
  transactionId:string|null;referenceConflict:boolean};
export type TestHandoffAttempt={attemptId:string;clientReference:string;
  providerCode:string;environment:"TEST";state:string};
export function readGatewayTestHandoff(search:string):TestHandoff|null{
  if(search.length>2048)return null;
  const params=new URLSearchParams(search);
  const attemptId=params.get("test_attempt");
  const reference=params.get("test_ref");
  if(!attemptId||!UUID.test(attemptId)||!reference||!REF.test(reference)||
     params.getAll("test_attempt").length!==1||
     params.getAll("test_ref").length!==1)return null;
  const tx=params.get("test_tx");
  return {attemptId,reference,referenceConflict:params.get("test_ref_conflict")==="1",
    transactionId:tx&&TX.test(tx)&&params.getAll("test_tx").length===1?tx:null};
}
export function matchingTestReturn(attempts:readonly TestHandoffAttempt[],
  handoff:TestHandoff):{match:TestHandoffAttempt|null;prefill:string|null}{
  if(handoff.referenceConflict)return {match:null,prefill:null};
  const match=attempts.find(a=>a.attemptId===handoff.attemptId&&
    a.clientReference===handoff.reference&&a.environment==="TEST"&&
    a.state==="PREPARED"&&
    ["PAYSTACK","FLUTTERWAVE"].includes(a.providerCode))??null;
  return {match,prefill:match?.providerCode==="FLUTTERWAVE"?
    handoff.transactionId:null};
}
