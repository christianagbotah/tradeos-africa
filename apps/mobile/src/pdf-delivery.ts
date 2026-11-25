export type PdfPaper="A5"|"80mm"|"58mm";
export const pdfPapers=["A5","80mm","58mm"] as const;
export function pdfFileName(kind:"receipt"|"document",id:string,paper:PdfPaper){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||!pdfPapers.includes(paper))throw new Error("Invalid document reference.");
 return "TradeOS-"+(kind==="receipt"?"Receipt":"Document")+"-"+id.slice(0,8)+"-"+paper+".pdf";
}
export function receiptAvailable(sale:{status:string;completedAt:string|null;lines:unknown[];payments:{status:string}[]}){
 return ["COMPLETED","PARTIALLY_REFUNDED","REFUNDED"].includes(sale.status)&&!!sale.completedAt&&sale.lines.length>0&&!sale.payments.some(p=>p.status==="PENDING");
}
