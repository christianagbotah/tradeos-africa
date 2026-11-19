/** Browser return parameters are untrusted hints, NEVER payment evidence. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE=/^[A-Za-z0-9_-]{4,36}$/;
const PROVIDER_TX=/^[1-9][0-9]{0,15}$/;
export type SandboxReturnContext={
  attemptId:string;expectedReference:string;providerStatus:string;
  transactionId:string|null;referenceConflict:boolean;
};
export function readSandboxReturn(search:string):SandboxReturnContext|null{
  if(search.length>2048)return null;
  const query=new URLSearchParams(search);
  const attemptId=query.get("attempt");
  const expectedReference=query.get("expected_ref");
  if(!attemptId||!UUID.test(attemptId)||!expectedReference||
     !REFERENCE.test(expectedReference)||query.getAll("attempt").length!==1||
     query.getAll("expected_ref").length!==1)return null;
  const transaction=query.get("transaction_id");
  const references=[...query.getAll("tx_ref"),...query.getAll("reference"),
    ...query.getAll("trxref")];
  return {
    attemptId,expectedReference,
    providerStatus:(query.get("status")??"unknown").slice(0,32),
    transactionId:transaction&&PROVIDER_TX.test(transaction)&&
      query.getAll("transaction_id").length===1?transaction:null,
    referenceConflict:references.some(ref=>ref!==expectedReference),
  };
}
export function sandboxSettingsUrl(context:SandboxReturnContext):string{
  const query=new URLSearchParams({
    section:"payments",test_attempt:context.attemptId,
    test_ref:context.expectedReference,
  });
  if(!context.referenceConflict&&context.transactionId)
    query.set("test_tx",context.transactionId);
  if(context.referenceConflict)query.set("test_ref_conflict","1");
  return "/settings?"+query.toString();
}
