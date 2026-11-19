/** A receipt PDF is fetched only from the authenticated server and only
 * for a completed sale. A text-only share is not a receipt.
 */
import { getOfflineQueue } from "./offline-sync";
import { readApiErrorMessage } from "./auth-fetch";
import { isReceiptIdentifier } from "./receipt-document";

export type ReceiptPaper = "A5" | "80mm" | "58mm";
export const RECEIPT_PAPER_OPTIONS:ReadonlyArray<{value:ReceiptPaper;label:string}> = [
  {value:"80mm",label:"80 mm thermal roll"},
  {value:"58mm",label:"58 mm thermal roll"},
  {value:"A5",label:"A5 sheet"},
];
const PAPER_STORAGE_KEY="tradeos.receipt.paper.v1";
export function loadReceiptPaper():ReceiptPaper {
  if(typeof window==="undefined")return "80mm";
  try {
    const stored=window.localStorage.getItem(PAPER_STORAGE_KEY);
    if(stored==="A5"||stored==="80mm"||stored==="58mm")return stored;
  }catch{/* private browsing storage may be unavailable */}
  return "80mm";
}
export function saveReceiptPaper(paper:ReceiptPaper):void {
  if(typeof window==="undefined")return;
  try { window.localStorage.setItem(PAPER_STORAGE_KEY,paper); }
  catch {/* printing does not depend on storage */}
}
export function receiptPdfFilename(saleId:string,paper:ReceiptPaper):string {
  if(!isReceiptIdentifier(saleId))throw new Error("Invalid receipt reference");
  return "TradeOS-Receipt-"+saleId.slice(0,8)+"-"+paper+".pdf";
}
export async function fetchVerifiedReceiptPdf(saleId:string,businessId:string,paper:ReceiptPaper):Promise<File> {
  if(!isReceiptIdentifier(saleId))throw new Error("Only completed sales can generate a receipt PDF.");
  if(!businessId)throw new Error("Sign in to the business before sharing this receipt.");
  if(!RECEIPT_PAPER_OPTIONS.some(o=>o.value===paper))throw new Error("Unsupported paper size");
  const response=await getOfflineQueue().authenticatedFetch(
    "/v1/sales/"+encodeURIComponent(saleId)+"/receipt.pdf?businessId="+
    encodeURIComponent(businessId)+"&paper="+encodeURIComponent(paper),
    {method:"GET",headers:{accept:"application/pdf"}},
  );
  if(!response.ok)throw new Error(await readApiErrorMessage(response,"Receipt PDF could not be generated"));
  if(!(response.headers.get("content-type")??"").toLowerCase().includes("application/pdf"))
    throw new Error("The server did not return a PDF.");
  const bytes=await response.blob();
  if(bytes.size<100 || bytes.size>6_000_000)throw new Error("Receipt PDF is empty or exceeds the allowed size.");
  const header=new Uint8Array(await bytes.slice(0,5).arrayBuffer());
  if(String.fromCharCode(...header)!=="%PDF-")throw new Error("Receipt file is not a valid PDF.");
  return new File([bytes],receiptPdfFilename(saleId,paper),{type:"application/pdf"});
}
export function downloadReceiptPdfFile(file:File):void {
  if(typeof document==="undefined")throw new Error("Download is only available in a browser.");
  const url=URL.createObjectURL(file);
  try {
    const anchor=document.createElement("a");
    anchor.href=url;
    anchor.download=file.name;
    anchor.style.display="none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }finally {
    window.setTimeout(()=>URL.revokeObjectURL(url),30_000);
  }
}
export async function downloadVerifiedReceiptPdf(saleId:string,businessId:string,paper:ReceiptPaper){
  const file=await fetchVerifiedReceiptPdf(saleId,businessId,paper);
  downloadReceiptPdfFile(file);
  return file;
}
/** Shares an actual PDF file. If the OS/browser cannot share files, downloads
 * the same PDF so the user can attach it through WhatsApp, email, etc.
 */
export async function shareVerifiedReceiptPdf(
  saleId:string,businessId:string,paper:ReceiptPaper,
):Promise<"shared"|"downloaded"|"cancelled"> {
  const file=await fetchVerifiedReceiptPdf(saleId,businessId,paper);
  let supportsFileSharing=false;
  if(typeof navigator!=="undefined" && typeof navigator.share==="function" &&
      typeof navigator.canShare==="function") {
    try { supportsFileSharing=navigator.canShare({files:[file]}); }
    catch { supportsFileSharing=false; }
  }
  if(supportsFileSharing){
    try {
      await navigator.share({files:[file],title:"TradeOS sales receipt"});
      return "shared";
    }catch(error){
      if(error instanceof Error && error.name==="AbortError")return "cancelled";
      // Some webviews claim file sharing but fail when opening the target app.
      // Deliver the already-verified PDF as a download, never substitute text.
    }
  }
  downloadReceiptPdfFile(file);
  return "downloaded";
}
