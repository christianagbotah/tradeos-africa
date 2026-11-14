import type { Metadata } from "next";
import { PasswordResetForm } from "../components/password-reset-form";

export const metadata: Metadata = {
  title: "Reset Password | TradeOS",
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <PasswordResetForm />;
}
