"use client";

import { useEffect,useState,type FormEvent } from "react";
import Link from "next/link";
import { AdminPasswordInput } from "../components/admin-password-input";

export default function AdminResetPasswordPage() {
  const [token,setToken]=useState<string|null>(null);
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(false);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    const url=new URL(window.location.href);
    const value=url.searchParams.get("token");
    setToken(value??"");
    if(value){
      url.searchParams.delete("token");
      window.history.replaceState(window.history.state,"",url.pathname+url.search+url.hash);
    }
  },[]);

  async function submit(event:FormEvent) {
    event.preventDefault();
    if(!token||busy||done)return;
    if(password.length<12) {setError("Use at least 12 characters.");return;}
    if(password!==confirm) {setError("The passwords do not match.");return;}
    setBusy(true);
    setError(null);
    try{
      const response=await fetch("/api/admin/password/reset",{
        method:"POST",headers:{"Content-Type":"application/json"},
        cache:"no-store",body:JSON.stringify({token,newPassword:password}),
      });
      const data=(await response.json()) as {message?:string};
      if(!response.ok){setError(data.message??"Recovery link could not be verified.");return;}
      setDone(true);
      setToken("");
      setPassword("");
      setConfirm("");
    }catch{setError("Unable to reach TradeOS. Check your connection.");}
    finally{setBusy(false);}
  }

  return (
    <main className="admin-auth-screen">
      <section className="admin-auth-card" aria-labelledby="admin-reset-heading">
        <div className="admin-auth-brand">
          <div className="admin-auth-mark" aria-hidden="true">T</div>
          <div><strong>TradeOS</strong><span>System Admin</span></div>
        </div>
        <p className="admin-auth-eyebrow">Administrator account recovery</p>
        <h1 id="admin-reset-heading">Choose a new password</h1>
        <p className="admin-auth-intro">
          Your link expires after 20 minutes and can be used only once.
          Resetting your password revokes every signed-in administrator session.
        </p>
        {done ? (
          <p role="status" className="admin-auth-success">
            Your administrator password has been reset. Sign in with your new password.
          </p>
        ) : token===null ? (
          <p className="admin-auth-intro" role="status">Checking reset link…</p>
        ) : !token ? (
          <p className="admin-auth-error" role="alert">
            Recovery link is missing. Request another link from sign in.
          </p>
        ) : (
          <form className="admin-auth-form" onSubmit={submit}>
            <label className="admin-auth-field">
              <span>New password</span>
              <AdminPasswordInput id="admin-new-password" autoComplete="new-password"
                value={password} onChange={(event)=>setPassword(event.target.value)}
                minLength={12} maxLength={200} required
                placeholder="At least 12 characters" />
            </label>
            <label className="admin-auth-field">
              <span>Confirm new password</span>
              <AdminPasswordInput id="admin-confirm-password" autoComplete="new-password"
                value={confirm} onChange={(event)=>setConfirm(event.target.value)}
                minLength={12} maxLength={200} required placeholder="Repeat your new password" />
            </label>
            {error ? <p className="admin-auth-error" role="alert">{error}</p> : null}
            <button className="admin-auth-submit" type="submit"
              disabled={busy||password.length<12||!confirm}>
              {busy?"Resetting…":"Set new password"}
            </button>
          </form>
        )}
        <p className="admin-auth-note">
          Lost access to your administrator email? Contact authorized Lightworld platform support.
        </p>
        <Link className="admin-auth-link" href="/">Back to administrator sign in</Link>
      </section>
    </main>
  );
}
