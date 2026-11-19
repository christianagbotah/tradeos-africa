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
/** Local, device-specific receipt printer preference. A cashier may switch
 * between businesses and branches in the same browser. Never read an
 * unscoped legacy preference: that would leak shop A's paper choice to B.
 * This is a per-device setting; it is not a server-wide printer policy.
 */
const PAPER_STORAGE_PREFIX="tradeos.receipt.paper.v2";
const DEFAULT_RECEIPT_PAPER:ReceiptPaper="80mm";
function paperPreferenceKey(businessId:string,branchId:string):string|null {
  if(!businessId?.trim() || !branchId?.trim())return null;
  return PAPER_STORAGE_PREFIX+"."+encodeURIComponent(businessId.trim())+
    "."+encodeURIComponent(branchId.trim());
}
export function loadReceiptPaper(businessId:string,branchId:string):ReceiptPaper {
  const key=paperPreferenceKey(businessId,branchId);
  if(typeof window==="undefined" || !key)return DEFAULT_RECEIPT_PAPER;
  try {
    const stored=window.localStorage.getItem(key);
    if(stored==="A5"||stored==="80mm"||stored==="58mm")return stored;
  }catch{/* private browsing storage may be unavailable */}
  return DEFAULT_RECEIPT_PAPER;
}
export function saveReceiptPaper(
  paper:ReceiptPaper,businessId:string,branchId:string,
):void {
  const key=paperPreferenceKey(businessId,branchId);
  if(typeof window==="undefined" || !key ||
     !RECEIPT_PAPER_OPTIONS.some(option=>option.value===paper))return;
  try { window.localStorage.setItem(key,paper); }
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
