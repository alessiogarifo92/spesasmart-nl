"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations("common");
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="pt-4">
      <EmptyState title={t("errorTitle")} body={t("errorBody")} action={<Button onClick={() => retry()}>{t("retry")}</Button>} />
    </div>
  );
}
