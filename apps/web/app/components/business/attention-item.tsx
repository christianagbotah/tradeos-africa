import React from "react";
import Link from "next/link";
export function AttentionItem({title,detail,priority,href,actionLabel,evidence=[]}:{title:string;detail:string;priority:"critical"|"warning"|"info"|"positive";href:string;actionLabel:string;evidence?:string[] | undefined}){return <article className={`tos-attention-item tos-attention-item--${priority}`}><div><strong>{title}</strong><p>{detail}</p>{evidence.length?<ul>{evidence.map((item)=><li key={item}>{item}</li>)}</ul>:null}</div><Link href={href}>{actionLabel}</Link></article>;}
