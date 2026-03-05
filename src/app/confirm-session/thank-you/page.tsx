import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";

export default function ThankYouPage() {
  return (
    <div className="min-h-screen">
      <section className="cg-section cg-shell-hero cg-theme-dark-bold">
        <div className="cg-container cg-gutters">
          <header className="mx-auto w-full max-w-4xl py-2 text-white">
            <div className="rounded-[30px] bg-white p-4 shadow-[0_16px_36px_rgba(5,46,30,0.16)]">
              <BrandWordmark className="h-auto w-full" priority />
            </div>

            <h1 className="mt-4 text-center text-[clamp(2rem,4.5vw,3.25rem)]">
              Session Confirmed
            </h1>
            <p className="mx-auto mt-2 max-w-3xl text-center text-sm font-normal text-white/85">
              Your session has been successfully booked.
            </p>
          </header>
        </div>
      </section>

      <section className="cg-section cg-theme-light">
        <div className="cg-container cg-gutters">
          <section className="cg-surface-card mx-auto w-full max-w-2xl p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
              <svg
                className="h-8 w-8 text-emerald-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold">Thank you!</h2>
            <p className="mt-2 text-sm text-[color:var(--muted)]">
              Your session time has been confirmed. You will receive a confirmation email with the
              full details shortly.
            </p>
            <p className="mt-4 text-sm text-[color:var(--muted)]">
              If you have any questions, please contact the operations team.
            </p>
          </section>
        </div>
      </section>
    </div>
  );
}
