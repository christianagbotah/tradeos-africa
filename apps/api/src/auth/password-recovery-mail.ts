import { spawn } from "node:child_process";

export interface PasswordResetMail {
  to: string;
  link: string;
  expiresInMinutes: number;
}

/** Only an explicitly configured, trusted HTTPS origin may generate reset links. */
export function passwordRecoveryMailSettings(env: NodeJS.ProcessEnv = process.env): {
  sender: string; publicOrigin: string; sendmailPath: string;
} | null {
  const sender = env.TRADEOS_PASSWORD_RESET_FROM?.trim() ?? "";
  const publicOrigin = env.TRADEOS_PASSWORD_RESET_PUBLIC_ORIGIN?.trim() ?? "";
  const sendmailPath = env.TRADEOS_SENDMAIL_PATH?.trim() || "/usr/sbin/sendmail";
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender) ||
      !/^\/[A-Za-z0-9_./-]+$/.test(sendmailPath)) return null;
  let origin: URL;
  try { origin = new URL(publicOrigin); } catch { return null; }
  if (origin.protocol !== "https:" || !origin.hostname || origin.username ||
      origin.password || origin.port || origin.pathname !== "/" || origin.search ||
      origin.hash || origin.hostname === "localhost" || origin.hostname === "127.0.0.1") {
    return null;
  }
  return { sender, publicOrigin: origin.origin, sendmailPath };
}

/**
 * Uses an existing VPS sendmail-compatible mail transfer agent (Exim/Postfix).
 * No shell, recipient options or user supplied header values. Credentials are
 * never logged and no delivery is claimed if the local mailer rejects the job.
 * SMTP queue acceptance is not recipient inbox delivery verification.
 */
export async function sendPasswordRecoveryEmail(
  mail: PasswordResetMail,
  settings: { sender: string; sendmailPath: string },
): Promise<void> {
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(mail.to)) {
    throw new Error("Password recovery destination is invalid");
  }
  const body =
    "From: TradeOS <" + settings.sender + ">\r\n" +
    "To: <" + mail.to + ">\r\n" +
    "Subject: Reset your TradeOS password\r\n" +
    "MIME-Version: 1.0\r\n" +
    "Content-Type: text/plain; charset=UTF-8\r\n" +
    "Auto-Submitted: auto-generated\r\n" +
    "\r\n" +
    "Someone requested a password reset for this TradeOS account.\r\n\r\n" +
    "Open this secure link to choose a new password:\r\n" +
    mail.link + "\r\n\r\n" +
    "This link expires in " + mail.expiresInMinutes + " minutes and can be used only once.\r\n" +
    "If you did not request this change, ignore this message. Your password has not changed.\r\n";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(settings.sendmailPath, ["-i", "-t"], {
      stdio: ["pipe", "ignore", "ignore"],
      shell: false,
      env: { PATH: "/usr/bin:/bin" },
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Password recovery mailer timed out"));
    }, 10000);
    let settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve();
    };
    child.once("error", (error) => done(error));
    child.once("close", (code) => done(code === 0 ? undefined : new Error("Password recovery mailer failed")));
    child.stdin.on("error", (error) => done(error));
    child.stdin.end(body);
  });
}
