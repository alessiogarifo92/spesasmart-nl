import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { adminToken, isAdmin } from "@/server/admin-auth";
import { AdminLoginForm } from "./login-form";

/**
 * Wraps every admin page. Without ADMIN_TOKEN the page does not exist; without a
 * session only the sign-in form is rendered, and `children` (a function, so no
 * admin data is even queried) is never called.
 */
export async function AdminGate({ children }: { children: () => Promise<ReactNode> }) {
  // Decided per request, never at build time: a build without the token must not freeze a 404.
  await connection();
  if (adminToken() === null) notFound();
  if (await isAdmin()) return <>{await children()}</>;
  const t = await getTranslations("admin");
  return (
    <>
      <PageHeader title={t("signInTitle")} />
      <AdminLoginForm labels={{ token: t("tokenLabel"), submit: t("signIn"), wrong: t("errorWrong") }} />
      <p className="text-label text-muted">{t("sessionNote")}</p>
    </>
  );
}
