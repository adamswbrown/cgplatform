"use client";

import { useState } from "react";
import type { IntakeFormContent } from "@/lib/intake-settings";

type CrisisSupportModalProps = {
  content: IntakeFormContent["crisisModal"];
};

export function CrisisSupportModal({ content }: CrisisSupportModalProps) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cg-cta-secondary mt-4 px-4 py-2 text-xs"
      >
        Show Crisis Contacts
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(5,46,30,0.45)] p-4">
      <div className="cg-surface-card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
        <h3>{content.title}</h3>
        <p className="mt-2 text-sm">{content.intro}</p>

        <div className="mt-4 space-y-3">
          {content.contacts.map((contact) => (
            <div key={`${contact.label}-${contact.phone}`} className="rounded-xl border border-[color:var(--border)] p-3">
              <p className="text-sm font-semibold">
                {contact.label}
                {contact.phone ? ` - ${contact.phone}` : ""}
              </p>
              {contact.description ? (
                <p className="mt-1 text-sm text-[color:var(--muted)]">{contact.description}</p>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={() => setOpen(false)} className="cg-cta-primary px-4 py-2 text-xs text-white">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
