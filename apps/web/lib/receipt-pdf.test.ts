import {afterEach,describe,expect,it,vi} from "vitest";
const api=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("./offline-sync",()=>({
  getOfflineQueue:()=>({authenticatedFetch:api.get}),
}));
import {
  fetchVerifiedReceiptPdf,shareVerifiedReceiptPdf,
  receiptPdfFilename,loadReceiptPaper,saveReceiptPaper,
} from "./receipt-pdf";

const saleId="b8fe8921-08a7-423c-b2eb-947beec01acd";
const businessId="36f81f12-68b8-4d4c-b58b-cb537d8140d2";
function pdfResponse(){
  const payload=new Uint8Array(200);
  payload.set(new TextEncoder().encode("%PDF-1.7"));
  return new Response(new Blob([payload],{type:"application/pdf"}),{
    status:200,headers:{"content-type":"application/pdf"},
  });
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
describe("receipt PDF share and download",()=>{
  it("fetches a tenant-scoped verified PDF and returns a real file",async()=>{
    api.get.mockResolvedValue(pdfResponse());
    const file=await fetchVerifiedReceiptPdf(saleId,businessId,"A5");
    expect(file.name).toBe("TradeOS-Receipt-b8fe8921-A5.pdf");
    expect(file.type).toBe("application/pdf");
    expect(await file.slice(0,5).text()).toBe("%PDF-");
    expect(api.get).toHaveBeenCalledWith(
      "/v1/sales/"+saleId+"/receipt.pdf?businessId="+businessId+"&paper=A5",
      {method:"GET",headers:{accept:"application/pdf"}},
    );
  });
  it("shares the PDF through the OS, never a receipt text",async()=>{
    api.get.mockResolvedValue(pdfResponse());
    const share=vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator",{share,canShare:vi.fn().mockReturnValue(true)});
    const outcome=await shareVerifiedReceiptPdf(saleId,businessId,"80mm");
    expect(outcome).toBe("shared");
    const call=share.mock.calls[0]?.[0];
    expect(call?.files).toHaveLength(1);
    expect(call.files[0].type).toBe("application/pdf");
    expect(call.text).toBeUndefined();
    expect(call.files[0].name).toMatch(/80mm\.pdf$/);
  });
  it("downloads the original PDF when the device cannot share files",async()=>{
    api.get.mockResolvedValue(pdfResponse());
    const clicks=vi.fn();
    const element={href:"",download:"",style:{display:""},click:clicks,remove:vi.fn()};
    const created=vi.fn().mockReturnValue(element);
    const appended=vi.fn();
    vi.stubGlobal("navigator",{share:vi.fn(),canShare:vi.fn().mockReturnValue(false)});
    vi.stubGlobal("document",{
      createElement:created,body:{appendChild:appended},
    });
    vi.stubGlobal("window",{setTimeout:vi.fn()});
    const createObjectURL=vi.spyOn(URL,"createObjectURL").mockReturnValue("blob:pdf");
    const outcome=await shareVerifiedReceiptPdf(saleId,businessId,"58mm");
    expect(outcome).toBe("downloaded");
    expect(created).toHaveBeenCalledWith("a");
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(element.href).toBe("blob:pdf");
    expect(element.download).toBe("TradeOS-Receipt-b8fe8921-58mm.pdf");
    expect(clicks).toHaveBeenCalledOnce();
    createObjectURL.mockRestore();
  });
  it("does not share invalid receipt IDs or a non-PDF response",async()=>{
    await expect(fetchVerifiedReceiptPdf("queued-local-id",businessId,"80mm"))
      .rejects.toThrow(/Only completed sales/);
    api.get.mockResolvedValue(new Response("not-pdf",{status:200,
      headers:{"content-type":"text/plain"}}));
    await expect(fetchVerifiedReceiptPdf(saleId,businessId,"A5"))
      .rejects.toThrow(/did not return a PDF/);
    expect(receiptPdfFilename(saleId,"58mm")).toContain("58mm.pdf");
  });
  it("restores selected paper without depending on enabled browser storage",()=>{
    const values=new Map<string,string>();
    vi.stubGlobal("window",{localStorage:{
      getItem:(key:string)=>values.get(key)??null,
      setItem:(key:string,value:string)=>values.set(key,value),
    }});
    expect(loadReceiptPaper()).toBe("80mm");
    saveReceiptPaper("A5");
    expect(loadReceiptPaper()).toBe("A5");
  });
});
