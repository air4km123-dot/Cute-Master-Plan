import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ModeProvider } from "@/components/ModeContext";
import AppShell from "@/components/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // Middleware already redirects, but a server component must never render
  // business data on the assumption that it did.
  if (!session) redirect("/login");

  return (
    <ModeProvider session={session}>
      <AppShell>{children}</AppShell>
    </ModeProvider>
  );
}
