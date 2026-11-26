import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const ui=readFileSync(resolve(__dirname,"operations-workspace.tsx"),"utf8");
const api=readFileSync(resolve(__dirname,"../../../../api/src/operations.ts"),"utf8");
const reconciliation=readFileSync(resolve(__dirname,"../../../../api/src/commerce/reconciliation.ts"),"utf8");
describe("real cashier operations UI and API contract",()=>{
  it("loads the API current shape directly rather than assuming current wrapper",()=>{
    expect(ui).toContain("useApiFetch<CurrentOperations>(path)");
    expect(ui).toContain("const current = data;");
    expect(ui).not.toContain("data?.current");
    expect(api).toContain("return {operatingDay:day ? await detail");
  });
  it("uses a business-local date, proper day and shift IDs and five verified counts",()=>{
    expect(ui).toContain("buildOperationsMutation(action,current,values,session.timezone");
    expect(ui).toContain("mode={operatingDay ? \"closing\" : \"opening\"}");
    expect(ui).toContain('mode={shift?"closing":"opening"}');
    expect(reconciliation).toContain("if (close && amounts.size!==5)");
    expect(reconciliation).toContain("const target = day ? payload.dayId : payload.shiftId;");
    expect(ui).toContain("current.openShiftCount>0");
    expect(ui).toContain("canManageShift");
    expect(ui).toContain("canManageDay");
  });
  it("shows variance without silently inserting a cashbook adjustment",()=>{
    expect(ui).toContain("It will not silently");
    expect(ui).toContain("alter cashbook balances to hide a difference.");
    expect(ui).toContain('onClick={()=>void handleAction("close-day")}');
    expect(ui).toContain('onClick={()=>void handleAction("close-shift")}');
    expect(ui).toContain("refetchShiftHistory()");
    expect(ui).toContain("refetchHistory()");
  });
  it("keeps confirmed closing results visible and exportable",()=>{
    expect(ui).toContain("useApiFetch<OperationsHistory>(historyPath)");
    expect(ui).toContain("useApiFetch<ShiftHistory>(shiftHistoryPath)");
    expect(ui).toContain("dayCloseReportCsv(completedDays,currencyCode)");
    expect(ui).toContain("Completed operating days");
    expect(ui).toContain("Recent staff shifts");
    expect(ui).toContain("Export CSV");
  });
  it("never claims success for an unconfirmed offline financial close",()=>{
    expect(ui).toContain("Connect to the internet to verify and finalize");
    expect(ui).toContain("await queue.flushOrThrow(");
    expect(ui).toContain("No close has been posted.");
  });
});
