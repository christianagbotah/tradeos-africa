import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import { formatMoney } from "@tradeos/contracts";

const require = createRequire(import.meta.url);
const REGULAR = require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff");
const BOLD = require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff");
const CEDI = require.resolve("@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff");
const INK = "#121924";
const MUTED = "#505764";
const MM = 72 / 25.4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReceiptPaper = "A5" | "80mm" | "58mm";
export const RECEIPT_PAPERS: readonly ReceiptPaper[] = ["A5", "80mm", "58mm"];

export function parseReceiptPaper(value: unknown): ReceiptPaper {
  if (value === undefined || value === null || value === "") return "80mm";
  if (value === "A5" || value === "80mm" || value === "58mm") return value;
  throw new Error("RECEIPT_PAPER_INVALID");
}
export function receiptPdfFilename(saleId: string, paper: ReceiptPaper): string {
  if (!UUID.test(saleId)) throw new Error("RECEIPT_ID_INVALID");
  return "TradeOS-Receipt-" + saleId.slice(0, 8) + "-" + paper + ".pdf";
}

export interface VerifiedReceiptSnapshot {
  saleId: string;
  status: "COMPLETED" | "PARTIALLY_REFUNDED" | "REFUNDED";
  completedAt: string;
  businessName: string;
  branchName: string;
  address: string;
  phone: string;
  timezone: string;
  customerName: string;
  cashierName: string;
  currencyCode: string;
  totalMinor: number;
  lines: Array<{
    name: string;
    quantity: number;
    unitCode: string;
    unitNetMinor: number;
    lineTaxMinor: number;
    lineTotalMinor: number;
  }>;
  payments: Array<{
    method: string;
    amountMinor: number;
    refundedMinor: number;
    status: string;
  }>;
}

function safeText(value: unknown, max = 250): string {
  if (typeof value !== "string" || value.length > max) throw new Error("RECEIPT_TEXT_INVALID");
  return value.replace(/[\x00-\x1f\x7f]/g, " ").trim();
}
function amount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("RECEIPT_AMOUNT_INVALID");
  }
  return value;
}
function verified(raw: VerifiedReceiptSnapshot) {
  if (!raw || typeof raw !== "object" || !UUID.test(raw.saleId) ||
      !["COMPLETED", "PARTIALLY_REFUNDED", "REFUNDED"].includes(raw.status) ||
      !raw.completedAt || !Number.isFinite(Date.parse(raw.completedAt)) ||
      !Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 300 ||
      !Array.isArray(raw.payments) || raw.payments.length > 30 ||
      !/^[A-Z]{3}$/.test(raw.currencyCode)) throw new Error("RECEIPT_SNAPSHOT_INVALID");
  const lines=raw.lines.map(l=>({
    name:safeText(l.name,300), quantity:l.quantity,unitCode:safeText(l.unitCode,35),
    unitNetMinor:amount(l.unitNetMinor),lineTaxMinor:amount(l.lineTaxMinor),
    lineTotalMinor:amount(l.lineTotalMinor),
  }));
  if (lines.some(l=>!l.name || !Number.isFinite(l.quantity) || l.quantity <= 0 ||
      l.quantity > 1e9)) throw new Error("RECEIPT_LINE_INVALID");
  const payments=raw.payments.map(p=>({
    method:safeText(p.method,45),amountMinor:amount(p.amountMinor),
    refundedMinor:amount(p.refundedMinor),status:safeText(p.status,35),
  }));
  if (payments.some(p=>p.status==="PENDING")) throw new Error("RECEIPT_PAYMENT_PENDING");
  return {
    ...raw, saleId:safeText(raw.saleId,40), totalMinor:amount(raw.totalMinor),
    businessName:safeText(raw.businessName), branchName:safeText(raw.branchName),
    address:safeText(raw.address,400),phone:safeText(raw.phone,60),
    timezone:safeText(raw.timezone,80), customerName:safeText(raw.customerName,260),
    cashierName:safeText(raw.cashierName,160),lines,payments,
  };
}

function printedDate(iso: string, zone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB",{
      timeZone: zone,day:"2-digit",month:"2-digit",year:"numeric",
      hour:"2-digit",minute:"2-digit",hourCycle:"h23",
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB",{
      timeZone:"Africa/Accra",day:"2-digit",month:"2-digit",year:"numeric",
      hour:"2-digit",minute:"2-digit",hourCycle:"h23",
    }).format(new Date(iso));
  }
}

export interface CommercialPdfSnapshot {
  documentId:string;documentNumber:string;kind:"QUOTATION"|"PROFORMA";status:"DRAFT"|"ISSUED"|"CANCELLED";
  createdAt:string;expiresAt:string|null;customerPhone:string;customerEmail:string;notes:string;
  businessName:string;branchName:string;address:string;phone:string;timezone:string;customerName:string;currencyCode:string;totalMinor:number;
  lines:VerifiedReceiptSnapshot["lines"];
}
type CommercialLabels=Pick<CommercialPdfSnapshot,"documentNumber"|"kind"|"status"|"expiresAt"|"customerPhone"|"customerEmail"|"notes">;
type Doc = PDFKit.PDFDocument;
function renderLayout(doc: Doc, data: ReturnType<typeof verified>,
  paper: ReceiptPaper, height: number, render: boolean, commercial?:CommercialLabels): number {
  const w = paper==="A5"?148*MM:paper==="80mm"?80*MM:58*MM;
  const thermal=paper!=="A5";
  const margin=thermal?(paper==="58mm"?3*MM:4*MM):10*MM;
  const content=w-2*margin;
  const base=thermal?(paper==="58mm"?7.4:8.4):9.4;
  const yStart=thermal?margin:13*MM;
  let y=yStart;
  let pageIndex=0;
  const setFont=(bold=false,size=base,color=INK)=>{
    doc.font(bold?BOLD:REGULAR).fontSize(size).fillColor(color);
  };
  const hText=(t:string,width:number,size=base,bold=false)=>{
    setFont(bold,size);
    return doc.heightOfString(t || " ",{width,lineGap:0});
  };
  const text=(t:string,x:number,yy:number,width:number,size=base,
    bold=false,align:"left"|"right"|"center"="left",color=INK)=>{
    const h=hText(t,width,size,bold);
    if(render){setFont(bold,size,color);doc.text(t,x,yy,{width,align,lineGap:0});}
    return h;
  };
  const moneyString=(minor:number)=>formatMoney(minor,data.currencyCode);
  const measureMoney=(minor:number,size:number)=>{
    const full=moneyString(minor);
    if(data.currencyCode!=="GHS"){setFont(true,size);return doc.widthOfString(full);}
    const number=full.replace(/^₵\s*/, "");
    setFont(true,size);const a=doc.widthOfString(number);
    doc.font(CEDI).fontSize(size);return a+doc.widthOfString("₵ ");
  };
  const drawMoney=(minor:number,x:number,yy:number,width:number,sz=base,bold=true)=>{
    const full=moneyString(minor);
    let size=sz;
    while(measureMoney(minor,size)>width && size>5.5)size-=0.4;
    const measured=measureMoney(minor,size);
    if(!render)return hText("1",width,size,bold);
    if(data.currencyCode==="GHS"){
      const number=full.replace(/^₵\s*/, "");
      const start=x+Math.max(0,width-measured);
      doc.font(CEDI).fontSize(size).fillColor(INK).text("₵ ",start,yy,{lineBreak:false});
      doc.font(bold?BOLD:REGULAR).fontSize(size).fillColor(INK)
        .text(number,start+measured-(doc.font(bold?BOLD:REGULAR).fontSize(size).widthOfString(number)),yy,{lineBreak:false});
    }else{
      setFont(bold,size);
      doc.text(full,x,yy,{width,align:"right",lineBreak:false});
    }
    return hText("1",width,size,bold);
  };
  const newPage=()=>{
    if(render){
      doc.addPage({size:[w,height],margin:0});
      if(pageIndex>0){
        text((commercial?"DOCUMENT CONTINUED · "+commercial.documentNumber:"RECEIPT CONTINUED · "+data.saleId.slice(0,8).toUpperCase()),
          margin,thermal?margin:10*MM,content,base-0.8,true,"center");
      }
    }
    pageIndex++;
    y=pageIndex>1?(thermal?margin+20:17*MM):yStart;
  };
  const ensure=(needed:number)=>{
    if(render && y+needed>height-margin-5 && y>yStart+5)newPage();
  };
  const gap=(n:number)=>{y+=n;};
  const rule=(thick=0.6)=>{
    ensure(5);
    if(render)doc.moveTo(margin,y).lineTo(w-margin,y).lineWidth(thick).strokeColor("#8b949f").stroke();
    y+=5;
  };
  const centered=(t:string,size=base,bold=false,color=INK)=>{
    const h=hText(t,content,size,bold);
    ensure(h+2);
    text(t,margin,y,content,size,bold,"center",color);
    gap(h+2);
  };
  const kv=(label:string,value:string)=>{
    const labelW=thermal?(paper==="58mm"?44:59):85;
    const valueW=content-labelW-4;
    const h=Math.max(hText(label,labelW,base-0.6),hText(value,valueW,base,true));
    ensure(h+4);
    text(label,margin,y,labelW,base-0.6,false,"left",MUTED);
    text(value,margin+labelW+4,y,valueW,base,true,"right");
    gap(h+4);
  };
  const totalLine=(label:string,minor:number,bold=false)=>{
    const valW=thermal?Math.min(content*.54,paper==="58mm"?87:111):125;
    const labW=content-valW-5;
    const sz=bold?(thermal?base+1.1:base+2):base;
    const h=Math.max(hText(label,labW,sz,bold),hText("1",valW,sz,bold));
    ensure(h+5);
    text(label,margin,y,labW,sz,bold);
    drawMoney(minor,margin+labW+5,y,valW,sz,bold);
    gap(h+5);
  };
  if(render)newPage();else pageIndex=1;
  centered(data.businessName,thermal?base+3.0:16,true);
  if(data.branchName)centered(data.branchName,base,false);
  if(data.address)centered(data.address,base-0.7,false,MUTED);
  if(data.phone)centered("Tel: "+data.phone,base-0.7,false,MUTED);
  gap(thermal?3:7);
  rule();
  if(commercial){
    centered(commercial.kind==="QUOTATION"?"QUOTATION":"PROFORMA INVOICE",thermal?base+1.2:base+3,true);
    centered(commercial.status==="DRAFT"?"DRAFT - NOT ISSUED":commercial.status==="CANCELLED"?"CANCELLED - NOT VALID":"ISSUED - NOT A PAYMENT RECEIPT",base-0.7,true);
    rule();kv("Document",commercial.documentNumber);kv("Date",printedDate(data.completedAt,data.timezone));
    if(commercial.expiresAt)kv("Valid until",printedDate(commercial.expiresAt,data.timezone));
    kv("Customer",data.customerName);
    if(commercial.customerPhone)kv("Phone",commercial.customerPhone);
    if(commercial.customerEmail)kv("Email",commercial.customerEmail);
  }else{
    centered(data.payments.some(p=>p.method==="CUSTOMER_CREDIT")?"CREDIT SALE RECORD":"SALES RECEIPT",thermal?base+1.2:base+3,true);
    const status=data.status==="REFUNDED"?"SALE REFUNDED":data.status==="PARTIALLY_REFUNDED"?"PARTIALLY REFUNDED":"SALE COMPLETED";
    centered(status,base-0.7,true);rule();
    kv("Receipt",data.saleId.slice(0,8).toUpperCase());kv("Date",printedDate(data.completedAt,data.timezone));
    kv("Customer",data.customerName||"Walk-in customer");if(data.cashierName)kv("Cashier",data.cashierName);
  }
  rule();
  if(thermal) {
    centered("ITEMS",base-0.2,true);
    for(const l of data.lines){
      // Ordinary thermal items appear on ONE horizontal row:
      // item name | quantity × unit @ unit price | line total.
      // Avoid tiny, unreadable text for genuinely long names: only those
      // rows wrap to an extra line at the physical width of the paper.
      const qtyText=l.quantity.toLocaleString("en-GH")+" × "+l.unitCode+" @";
      const spacing=3;
      const minSize=paper==="58mm"?6.1:6.6;
      const sizes=(size:number)=>{
        setFont(true,size);
        const name=doc.widthOfString(l.name);
        setFont(false,size);
        const qty=doc.widthOfString(qtyText);
        const price=measureMoney(l.unitNetMinor,size);
        const total=measureMoney(l.lineTotalMinor,size);
        return {name,qty,price,total,
          sum:name+qty+price+total+spacing*3};
      };
      let size=base-0.15;
      let measured=sizes(size);
      while(measured.sum>content && size>minSize){
        size=Math.max(minSize,Math.round((size-0.2)*100)/100);
        measured=sizes(size);
      }
      if(measured.sum<=content){
        const h=hText(l.name,content,size,true);
        ensure(h+8);
        let x=margin;
        text(l.name,x,y,measured.name,size,true);
        x+=measured.name+spacing;
        text(qtyText,x,y,measured.qty,size,false,"left",MUTED);
        x+=measured.qty+spacing;
        drawMoney(l.unitNetMinor,x,y,measured.price,size,false);
        x+=measured.price+spacing;
        drawMoney(l.lineTotalMinor,x,y,content-(x-margin),size,true);
        gap(h+8);
      }else{
        const nameH=hText(l.name,content,base,true);
        ensure(nameH+base*2+11);
        text(l.name,margin,y,content,base,true);
        gap(nameH+2);
        // Keep quantity, '@', unit price, and amount together on one
        // horizontal row even when a long product name needs wrapping.
        let subsize=Math.max(6.2,base-0.7);
        const terms=(sz:number)=>{
          setFont(false,sz);
          return {
            qty:doc.widthOfString(qtyText),
            unit:measureMoney(l.unitNetMinor,sz),
            total:measureMoney(l.lineTotalMinor,sz),
          };
        };
        let sub=terms(subsize);
        while(sub.qty+sub.unit+sub.total+spacing*2>content && subsize>5.9){
          subsize=Math.max(5.9,Math.round((subsize-0.2)*100)/100);
          sub=terms(subsize);
        }
        const h=hText("1",content,subsize);
        ensure(h+8);
        let x=margin;
        text(qtyText,x,y,sub.qty,subsize,false,"left",MUTED);
        x+=sub.qty+spacing;
        drawMoney(l.unitNetMinor,x,y,sub.unit,subsize,false);
        x+=sub.unit+spacing;
        drawMoney(l.lineTotalMinor,x,y,content-(x-margin),subsize,true);
        gap(h+8);
      }
      rule(0.3);
    }
  } else {
    const nameW=content*.45;
    const qtyW=content*.10;
    const unitW=content*.20;
    const totalW=content-nameW-qtyW-unitW;
    const col=[margin,margin+nameW,margin+nameW+qtyW,margin+nameW+qtyW+unitW] as const;
    const row=(name:string,qty:string,unit:number,total:number,header=false)=>{
      const sz=header?base-0.8:base;
      const nameH=hText(name,nameW-7,sz,header?true:false);
      const rowH=Math.max(15,nameH+5);
      ensure(rowH+3);
      text(name,col[0],y,nameW-7,sz,header);
      text(qty,col[1],y,qtyW-3,sz,header,"center");
      if(header){
        text("Unit price",col[2],y,unitW-3,sz,true,"right");
        text("Amount",col[3],y,totalW,sz,true,"right");
      }else{
        drawMoney(unit,col[2],y,unitW-3,sz-0.3,false);
        drawMoney(total,col[3],y,totalW,sz,true);
      }
      gap(rowH+3);
    };
    const tableTitleHeight=18;
    ensure(tableTitleHeight);
    text("Item",margin,y,nameW-7,base-0.8,true);
    text("Qty",col[1],y,qtyW-3,base-0.8,true,"center");
    text("Unit price",col[2],y,unitW-3,base-0.8,true,"right");
    text("Amount",col[3],y,totalW,base-0.8,true,"right");
    gap(18);rule();
    for(const l of data.lines)row(l.name,l.quantity.toLocaleString("en-GH"),
      l.unitNetMinor,l.lineTotalMinor);
  }
  gap(4);
  rule(1);
  const tax=data.lines.reduce((n,l)=>n+l.lineTaxMinor,0);
  if(tax>0)totalLine("Included tax",tax);
  totalLine(commercial?"Document total":"Sale total",data.totalMinor,true);
  for(const p of data.payments) {
    totalLine(p.method.replaceAll("_"," "),p.amountMinor);
  }
  const credit=data.payments.filter(p=>p.method==="CUSTOMER_CREDIT")
    .reduce((n,p)=>n+p.amountMinor,0);
  const paid=data.payments.filter(p=>p.method!=="CUSTOMER_CREDIT" &&
    ["SUCCEEDED","REVERSED","PARTIALLY_REVERSED"].includes(p.status))
    .reduce((n,p)=>n+p.amountMinor,0);
  if(credit>0){
    totalLine("Customer credit (not collected)",credit);
    totalLine("Payment collected",paid);
  }
  const refunded=data.payments.reduce((n,p)=>n+p.refundedMinor,0);
  if(refunded>0){
    totalLine("Refunded after sale",refunded);
    totalLine("Net received",Math.max(0,paid-refunded),true);
  }
  rule();
  gap(5);
  if(commercial){
    if(commercial.notes){
      // Split long notes into bounded segments so each fits on a thermal page.
      centered("Notes",base,true);
      const words=commercial.notes.match(/.{1,160}(?:\s|$)|.{1,160}/g)??[];
      for(const part of words)centered(part.trim(),base-0.5,false);
    }
    centered("Not proof of payment. No sale or stock movement is recorded by this document.",base-1,false,MUTED);
  }else{
    centered("Thank you for your business.",base+0.4,true);
    centered("Reference: "+data.saleId,base-1,false,MUTED);
    centered("This receipt reflects the recorded sale. Returns and refunds are recorded separately.",base-1,false,MUTED);
  }
  gap(2);
  centered("Powered by TradeOS Africa",base-1,false,MUTED);
  return y;
}

export async function renderVerifiedSaleReceiptPdf(snapshot:VerifiedReceiptSnapshot,paper:ReceiptPaper="80mm"):Promise<Buffer>{
  return renderPdf(verified(snapshot),paper);
}
export async function renderCommercialDocumentPdf(snapshot:CommercialPdfSnapshot,paper:ReceiptPaper="A5"):Promise<Buffer>{
  if(!["QUOTATION","PROFORMA"].includes(snapshot.kind)||!["DRAFT","ISSUED","CANCELLED"].includes(snapshot.status)||!snapshot.documentNumber||
    (snapshot.expiresAt!==null&&!Number.isFinite(Date.parse(snapshot.expiresAt))))throw new Error("COMMERCIAL_PDF_INVALID");
  const commercial:CommercialLabels={kind:snapshot.kind,status:snapshot.status,documentNumber:safeText(snapshot.documentNumber,80),expiresAt:snapshot.expiresAt,
    customerPhone:safeText(snapshot.customerPhone,40),customerEmail:safeText(snapshot.customerEmail,180),notes:safeText(snapshot.notes,2000)};
  const data=verified({saleId:snapshot.documentId,status:"COMPLETED",completedAt:snapshot.createdAt,businessName:snapshot.businessName,branchName:snapshot.branchName,address:snapshot.address,phone:snapshot.phone,timezone:snapshot.timezone,customerName:snapshot.customerName,cashierName:"",currencyCode:snapshot.currencyCode,totalMinor:snapshot.totalMinor,lines:snapshot.lines,payments:[]});
  if(data.lines.reduce((n,l)=>n+BigInt(l.lineTotalMinor),0n)!==BigInt(data.totalMinor))throw new Error("COMMERCIAL_PDF_TOTAL_MISMATCH");
  return renderPdf(data,paper,commercial);
}
async function renderPdf(data:ReturnType<typeof verified>,paper:ReceiptPaper,commercial?:CommercialLabels):Promise<Buffer>{
  const w=paper==="A5"?148*MM:paper==="80mm"?80*MM:58*MM;
  let pageHeight=210*MM;
  if(paper!=="A5"){
    const probe=new PDFDocument({autoFirstPage:false,margin:0});
    probe.addPage({size:[w,6000],margin:0});
    const measured=renderLayout(probe,data,paper,6000,false,commercial);
    pageHeight=Math.max(120,Math.min(1600,measured+Math.max(28,2*(paper==="58mm"?3:4)*MM+10)));
    probe.destroy();
  }
  return await new Promise<Buffer>((resolve,reject)=>{
    const doc=new PDFDocument({autoFirstPage:false,margin:0,bufferPages:true,
      info:{
        Title:commercial?commercial.kind+" "+commercial.documentNumber:"Verified sales receipt "+data.saleId.slice(0,8).toUpperCase(),
        Author:"TradeOS Africa",
        Subject:commercial?"Commercial document - not proof of payment":"Verified sales record · "+paper,
      }});
    const chunks:Buffer[]=[];
    let bytes=0;
    doc.on("data",(part:Buffer)=>{
      bytes+=part.length;
      if(bytes>6_000_000){doc.destroy(new Error("RECEIPT_PDF_TOO_LARGE"));return;}
      chunks.push(part);
    });
    doc.once("error",reject);
    doc.once("end",()=>resolve(Buffer.concat(chunks)));
    try{
      renderLayout(doc,data,paper,pageHeight,true,commercial);
      doc.end();
    }catch(err){doc.destroy(err instanceof Error?err:new Error("RECEIPT_RENDER_FAILED"));}
  });
}
