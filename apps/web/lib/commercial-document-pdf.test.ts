import {afterEach,describe,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({get:vi.fn(),download:vi.fn()}));
vi.mock("./offline-sync",()=>({getOfflineQueue:()=>({authenticatedFetch:api.get})}));
vi.mock("./receipt-pdf",()=>({downloadReceiptPdfFile:api.download,RECEIPT_PAPER_OPTIONS:[{value:"A5"},{value:"80mm"},{value:"58mm"}]}));
import {prepareCommercialPdf,sharePreparedCommercialPdf} from "./commercial-document-pdf";
const input={documentId:"b8fe8921-08a7-423c-b2eb-947beec01acd",businessId:"36f81f12-68b8-4d4c-b58b-cb537d8140d2",branchId:"aa6b7342-7e1a-4dd1-83a4-77d5f6d99240",kind:"PROFORMA" as const,paper:"A5" as const};
function pdf(){const content=new Uint8Array(200);content.set(new TextEncoder().encode("%PDF-1.7"));return new Response(content,{headers:{"content-type":"application/pdf"}});}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe("commercial PDF sharing",()=>{
  it("fetches only the authenticated scoped PDF for sharing",async()=>{
    api.get.mockResolvedValue(pdf());
    const file=await prepareCommercialPdf(input);
    expect(file.name).toBe("TradeOS-PROFORMA-b8fe8921-A5.pdf");
    expect(await file.slice(0,5).text()).toBe("%PDF-");
    expect(api.get).toHaveBeenCalledWith("/v1/commercial-documents/"+input.documentId+"/pdf?businessId="+input.businessId+"&branchId="+input.branchId+"&paper=A5&purpose=share",{method:"GET",headers:{accept:"application/pdf"},cache:"no-store"});
  });
  it("rejects invalid IDs, responses and forged PDF signatures",async()=>{
    await expect(prepareCommercialPdf({...input,documentId:"local"})).rejects.toThrow(/valid/);
    expect(api.get).not.toHaveBeenCalled();
    api.get.mockResolvedValue(new Response("wrong",{headers:{"content-type":"text/html"}}));
    await expect(prepareCommercialPdf(input)).rejects.toThrow(/did not return a PDF/);
    api.get.mockResolvedValue(new Response("x".repeat(200),{headers:{"content-type":"application/pdf"}}));
    await expect(prepareCommercialPdf(input)).rejects.toThrow(/invalid PDF/);
  });
  it("hands the actual file to OS share without text",async()=>{
    api.get.mockResolvedValue(pdf());
    const file=await prepareCommercialPdf(input);
    const share=vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator",{share,canShare:()=>true});
    expect(await sharePreparedCommercialPdf(file)).toBe("shared");
    expect(share).toHaveBeenCalledWith({files:[file],title:"TradeOS business document"});
    expect(api.download).not.toHaveBeenCalled();
  });
  it("downloads the same file if sharing is unavailable, not on cancellation",async()=>{
    api.get.mockResolvedValue(pdf());
    const file=await prepareCommercialPdf(input);
    vi.stubGlobal("navigator",{share:vi.fn(),canShare:()=>false});
    expect(await sharePreparedCommercialPdf(file)).toBe("downloaded");
    expect(api.download).toHaveBeenCalledWith(file);
    api.download.mockClear();
    const error=new Error("cancelled");error.name="AbortError";
    vi.stubGlobal("navigator",{share:vi.fn().mockRejectedValue(error),canShare:()=>true});
    expect(await sharePreparedCommercialPdf(file)).toBe("cancelled");
    expect(api.download).not.toHaveBeenCalled();
  });
});
