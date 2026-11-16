// Runs only in GitHub Visual QA's isolated DB and web instance.
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {chromium} from "playwright";

const API=process.env.PRINT_QA_API||"http://127.0.0.1:4000";
const WEB=process.env.PRINT_QA_WEB||"http://localhost:3000";
const folder="docs/qa/evidence/print-qa";
const email="print-"+randomUUID().slice(0,8)+"@tradeos.test";
const password="Print-Receipt-QA-Only-1234!";
const deviceKey="print-qa-"+randomUUID();
async function api(path,method="GET",data,token){
  const response=await fetch(API+path,{
    method,headers:{"content-type":"application/json",
      ...(token?{authorization:"Bearer "+token}:{})},
    body:data===undefined?undefined:JSON.stringify(data),
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(
    "Print fixture "+method+" "+path+" HTTP "+response.status+" "+JSON.stringify(result));
  return result;
}
async function fixtures(){
  const registered=await api("/v1/auth/register","POST",{
    displayName:"Print Test Owner",email,password,deviceKey,platform:"WEB",appVersion:"qa-1",
  });
  const token=registered.session.accessToken;
  const joined=await api("/v1/onboarding/business","POST",{
    name:"Receipt Printing QA",businessType:"RETAIL_HARDWARE",branchName:"Main",
    countryCode:"GH",currencyCode:"GHS",timezone:"Africa/Accra",
  },token);
  const businessId=joined.business.id,branchId=joined.branch.id;
  const service=(await api("/v1/catalog/items","POST",{
    businessId,name:"Print QA Tailoring",kind:"SERVICE",
    units:[{code:"service",label:"Service",canSell:true,defaultSalePriceMinor:2500}],
  },token)).item.id;
  const product=(await api("/v1/catalog/items","POST",{
    businessId,name:"Print QA Screws",kind:"PRODUCT",stockUnitCode:"piece",
    trackStock:true,units:[{code:"piece",label:"Piece",canStock:true,
      canPurchase:true,canSell:true,defaultSalePriceMinor:400}],
    openingStock:{branchId,quantity:50},
  },token)).item.id;
  const supplier=(await api("/v1/suppliers","POST",{
    businessId,name:"Print QA Wholesale",phone:"+233500002222",
  },token)).supplier.id;
  const quote=(await api("/v1/commercial-documents","POST",{
    businessId,branchId,clientRequestId:randomUUID(),kind:"QUOTATION",
    customerName:"Print QA Customer",
    lines:[{itemId:service,saleUnitCode:"service",quantity:2}],
  },token)).document.id;
  await api("/v1/commercial-documents/"+quote+"/issue","POST",{businessId},token);
  const po=(await api("/v1/purchase-orders","POST",{
    businessId,branchId,supplierId:supplier,clientRequestId:randomUUID(),
    lines:[{itemId:product,purchaseUnitCode:"piece",quantity:4,unitCostMinor:260}],
  },token)).order.id;
  await api("/v1/purchase-orders/"+po+"/issue","POST",{businessId},token);
  const sale=await api("/v1/sync","POST",{mutations:[{
    businessId,branchId,clientId:deviceKey,clientMutationId:randomUUID(),
    mutationType:"SALE_CREATE",occurredAt:new Date().toISOString(),
    payload:{currencyCode:"GHS",paymentMethod:"CASH",
      lines:[{itemId:service,saleUnitCode:"service",quantity:1}]},
  }]},token);
  const result=sale.mutationResults?.[0];
  if(result?.status!=="APPLIED"||!result.result?.saleId){
    throw new Error("Print fixture sale was not posted: "+JSON.stringify(result));
  }
  return {sale:result.result.saleId,quote,po};
}
async function checkPrint(page,label,path,selector,needle){
  await page.goto(WEB+path,{waitUntil:"domcontentloaded",timeout:30000});
  await page.locator(selector).waitFor({state:"visible",timeout:30000});
  await page.emulateMedia({media:"print"});
  await page.evaluate(()=>document.fonts.ready);
  const state=await page.evaluate((selector)=>{
    const node=document.querySelector(selector);
    const shell=node?.closest(".tos-shell");
    if(!node||!shell)return null;
    const rect=node.getBoundingClientRect(),computed=getComputedStyle(node);
    return {width:rect.width,height:rect.height,
      visibility:computed.visibility,display:computed.display,
      shell:getComputedStyle(shell).display,
      sidebar:getComputedStyle(shell.querySelector(".tos-sidebar")).display,
      topbar:getComputedStyle(shell.querySelector(".tos-topbar")).display,
      text:node.innerText};
  },selector);
  if(!state||state.visibility!=="visible"||state.display==="none"||
    state.width<80||state.height<100||state.shell!=="block"||
    state.sidebar!=="none"||state.topbar!=="none"||
    !state.text.includes(needle)||!state.text.includes("₵"))
    throw new Error("Blank "+label+" print layout: "+
      JSON.stringify(state).slice(0,1400));
  const pdf=await page.pdf({printBackground:true,preferCSSPageSize:true});
  if(pdf.byteLength<7000)
    throw new Error("PDF too small for "+label+": "+pdf.byteLength);
  await writeFile(folder+"/"+label+".pdf",pdf);
  const extracted=spawnSync("pdftotext",["-","-"],{
    input:pdf,encoding:"utf8",timeout:15000,
  });
  if(!extracted.error&&extracted.status===0&&!extracted.stdout.includes(needle))
    throw new Error("Generated "+label+" PDF lacks actual rendered text: "+needle);
  if(extracted.error&&extracted.error.code!=="ENOENT")
    throw extracted.error;
  console.log("PRINT PASS "+label+": "+state.width.toFixed(0)+"x"+
    state.height.toFixed(0)+", PDF "+pdf.byteLength+" bytes");
  await page.emulateMedia({media:"screen"});
}
await mkdir(folder,{recursive:true});
const ids=await fixtures();
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(WEB+"/",{waitUntil:"networkidle",timeout:30000});
  const emailInput=page.locator('input[type="email"]');
  if(await emailInput.count())await emailInput.fill(email);
  else await page.locator(".tos-input").first().fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL("**/dashboard",{timeout:30000});
  await checkPrint(page,"sale-receipt","/sales/receipt/"+ids.sale,
    "#tos-verified-receipt","Print QA Tailoring");
  await checkPrint(page,"quotation","/documents/"+ids.quote,
    "#tradeos-commercial-document","Print QA Customer");
  await checkPrint(page,"purchase-order","/purchase-orders/"+ids.po,
    "#tradeos-supplier-po","Print QA Wholesale");
}finally{
  await browser.close();
}
