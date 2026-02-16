import Link from "next/link";
import { FormPinEntry } from "@/components/forms/form-pin-entry";
import { BrandWordmark } from "@/components/brand-wordmark";

type FormAccessPageProps = {
  params: Promise<{ accessKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FormAccessPage({ params, searchParams }: FormAccessPageProps) {
  const { accessKey } = await params;
  const query = await searchParams;

  const nextPathCandidate = typeof query.next === "string" ? query.next : null;
  const nextPath = nextPathCandidate && nextPathCandidate.startsWith("/") ? nextPathCandidate : null;

  return (
    <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
      <div className="mx-auto w-full max-w-[520px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
        <BrandWordmark className="mx-auto h-14 w-auto" />
        <h1 className="mt-6 text-center text-3xl font-bold text-[color:var(--cg-ink)]">
          Secure Form Access
        </h1>
        <p className="mt-2 text-center text-sm text-[color:var(--muted)]">
          Enter the PIN sent to you by email to continue.
        </p>

        <div className="mt-6">
          <FormPinEntry accessKey={accessKey} nextPath={nextPath} />
        </div>

        <p className="mt-4 text-center text-xs text-[color:var(--muted)]">
          If your PIN has expired, contact the counselling team for a new code.
        </p>
        <p className="mt-2 text-center text-xs">
          <Link href="/intake" className="underline">
            Back to intake
          </Link>
        </p>
      </div>
    </main>
  );
}
