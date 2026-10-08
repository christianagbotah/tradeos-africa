import React from "react";
import Link from "next/link"; import type { ReactNode } from "react";
export function QuickAction({href,label,description,icon}:{href:string;label:string;description?:string;icon?:ReactNode}){return <Link className="tos-quick-action" href={href}><span className="tos-quick-action-icon" aria-hidden="true">{icon??"→"}</span><span><strong>{label}</strong>{description?<small>{description}</small>:null}</span></Link>;}
