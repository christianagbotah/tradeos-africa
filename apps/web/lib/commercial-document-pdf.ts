import { getOfflineQueue } from "./offline-sync";
import { readApiErrorMessage } from "./auth-fetch";
import { downloadReceiptPdfFile, RECEIPT_PAPER_OPTIONS, type ReceiptPaper } from "./receipt-pdf";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type CommercialPdfKind="QUOTATION"|"PROFORMA";
export async function prepareCommercialPdf(input:{
  documentId:string;businessId:string;branchId:string;kind:CommercialPdfKind;paper:ReceiptPaper
}):Promise<File>{
  const {documentId,businessId,branchId,kind,paper}=input;
  if(![documentId,businessId,branchId].every(value=>UUID.test(value)))throw new Error("Select a valid business document.");
  if(kind!=="QUOTATION"&&kind!=="PROFORMA")throw new Error("Unsupported document kind.");
  if(!RECEIPT_PAPER_OPTIONS.some(option=>option.value===paper))throw new Error("Unsupported paper size.");
  const query=new URLSearchParams({businessId,branchId,paper,purpose:"share"});
  const response=await getOfflineQueue().authenticatedFetch(
    "/v1/commercial-documents/"+encodeURIComponent(documentId)+"/pdf?"+query.toString(),
    {method:"GET",headers:{accept:"application/pdf"},cache:"no-store"},
  );
  if(!response.ok)throw new Error(await readApiErrorMessage(response,"Document PDF could not be prepared"));
  if(!(response.headers.get("content-type")??"").toLowerCase().startsWith("application/pdf"))throw new Error("The server did not return a PDF.");
  const bytes=await response.blob();
  if(bytes.size<100||bytes.size>6_000_000||await bytes.slice(0,5).text()!=="%PDF-")throw new Error("The server returned an invalid PDF.");
  return new File([bytes],"TradeOS-"+kind+"-"+documentId.slice(0,8)+"-"+paper+".pdf",{type:"application/pdf"});
}

/** Call directly from the user's Share click, with the already prepared file.
 * A browser lacking file sharing downloads the file, never substitutes text. */
export async function sharePreparedCommercialPdf(file:File):Promise<"shared"|"downloaded"|"cancelled">{
  if(file.type!=="application/pdf"||!file.name.endsWith(".pdf"))throw new Error("A prepared PDF is required.");
  let supported=false;
  try{supported=typeof navigator!=="undefined"&&typeof navigator.share==="function"&&typeof navigator.canShare==="function"&&navigator.canShare({files:[file]});}catch{/* use download */}
  if(supported){
    try{await navigator.share({files:[file],title:"TradeOS business document"});return "shared";}
    catch(error){if(error instanceof Error&&error.name==="AbortError")return "cancelled";}
  }
  downloadReceiptPdfFile(file);
  return "downloaded";
}
