import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in — Air4 Master Plan" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="sheet-grid min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-[400px]">
        {/* Sheet header, drafted as a title strip. */}
        <div className="border-2 border-ink bg-sheet-raised">
          <div className="flex items-stretch border-b-2 border-ink">
            <div className="px-4 py-3 border-r border-rule">
              <div className="anno">Air4</div>
              <div className="anno mt-0.5">Sheet 01</div>
            </div>
            <div className="px-4 py-3 flex-1">
              <h1 className="anno-lg">Master Plan</h1>
              <p className="note mt-1">Integrated Business System</p>
            </div>
          </div>

          <div className="p-5">
            <LoginForm next={target} />
          </div>

          <div className="border-t border-rule px-4 py-2.5 flex justify-between">
            <span className="anno">Rev V2</span>
            <span className="anno">44 Projects · 12 Departments</span>
          </div>
        </div>

        <p className="note mt-3 text-center">
          Air4 accounts only. Ask an administrator to set up access.
        </p>
      </div>
    </main>
  );
}
