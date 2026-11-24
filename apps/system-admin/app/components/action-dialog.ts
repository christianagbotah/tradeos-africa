"use client";

type DialogOptions = { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Request = { message:string; options:DialogOptions; prompt?:string; resolve:(value:string|null)=>void };
const pending:Request[]=[];
let active=false;
function showNext(){
  if(active||!pending.length)return;
  active=true;
  const req=pending.shift()!;
  const previouslyFocused=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const dialog=document.createElement("dialog");
  dialog.className="tos-custom-dialog";
  dialog.setAttribute("aria-labelledby","tos-custom-dialog-title");
  dialog.setAttribute("aria-describedby","tos-custom-dialog-message");
  const heading=document.createElement("h2");heading.id="tos-custom-dialog-title";
  heading.textContent=req.options.title??(req.prompt!==undefined?"Enter details":"Confirm action");
  const icon=document.createElement("span");icon.className="tos-custom-dialog-icon";icon.textContent="?";icon.setAttribute("aria-hidden","true");
  const message=document.createElement("p");message.id="tos-custom-dialog-message";message.textContent=req.message;
  const form=document.createElement("form");form.className="tos-custom-dialog-form";
  let input:HTMLInputElement|undefined;
  if(req.prompt!==undefined){input=document.createElement("input");input.value=req.prompt;input.setAttribute("aria-label",req.message);form.append(input);}
  const actions=document.createElement("div");actions.className="tos-custom-dialog-actions";
  const cancel=document.createElement("button");cancel.type="button";cancel.textContent=req.options.cancelLabel??"Cancel";
  const ok=document.createElement("button");ok.type="submit";ok.className=req.options.danger?"is-danger":"is-primary";ok.textContent=req.options.confirmLabel??"Confirm";
  actions.append(cancel,ok);form.append(actions);dialog.append(icon,heading,message,form);
  let done=false;
  function finish(value:string|null){
    if(done)return;done=true;dialog.close();dialog.remove();previouslyFocused?.focus();
    active=false;req.resolve(value);queueMicrotask(showNext);
  }
  cancel.onclick=()=>finish(null);
  dialog.addEventListener("cancel",event=>{event.preventDefault();finish(null);});
  dialog.addEventListener("close",()=>finish(null));
  form.onsubmit=event=>{event.preventDefault();finish(input?.value??"confirmed");};
  document.body.append(dialog);
  try{dialog.showModal();(input??cancel).focus();}catch{finish(null);}
}
function request(message:string,options:DialogOptions,prompt?:string):Promise<string|null>{
  if(typeof document==="undefined")return Promise.resolve(null);
  return new Promise(resolve=>{pending.push({message,options,...(prompt!==undefined?{prompt}:{}),resolve});showNext();});
}
export async function confirmAction(message:string,options:DialogOptions={}):Promise<boolean>{
  return (await request(message,options))!==null;
}
export function promptAction(message:string,initial="",options:DialogOptions={}):Promise<string|null>{
  return request(message,options,initial);
}
