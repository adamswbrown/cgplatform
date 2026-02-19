"use client";

import { useMemo, useState } from "react";
import type { AvailabilityNote, CrisisContact } from "@/lib/intake-settings";

type IntakeStructuredEditorsProps = {
  initialCrisisContacts: CrisisContact[];
  initialAvailabilityNotes: AvailabilityNote[];
};

function normalizeCrisisContacts(contacts: CrisisContact[]) {
  if (contacts.length > 0) {
    return contacts;
  }

  return [
    {
      label: "",
      phone: "",
      description: "",
    },
  ] satisfies CrisisContact[];
}

function normalizeAvailabilityNotes(notes: AvailabilityNote[]) {
  if (notes.length > 0) {
    return notes;
  }

  return [
    {
      title: "",
      body: "",
    },
  ] satisfies AvailabilityNote[];
}

export function IntakeStructuredEditors({
  initialCrisisContacts,
  initialAvailabilityNotes,
}: IntakeStructuredEditorsProps) {
  const [crisisContacts, setCrisisContacts] = useState<CrisisContact[]>(
    normalizeCrisisContacts(initialCrisisContacts),
  );
  const [availabilityNotes, setAvailabilityNotes] = useState<AvailabilityNote[]>(
    normalizeAvailabilityNotes(initialAvailabilityNotes),
  );

  const serializedCrisisContacts = useMemo(
    () => JSON.stringify(crisisContacts),
    [crisisContacts],
  );
  const serializedAvailabilityNotes = useMemo(
    () => JSON.stringify(availabilityNotes),
    [availabilityNotes],
  );

  return (
    <div className="space-y-5">
      <input type="hidden" name="crisisContactsJson" value={serializedCrisisContacts} />
      <input type="hidden" name="availabilityNotesJson" value={serializedAvailabilityNotes} />

      <section className="rounded-2xl border border-[color:var(--border)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Crisis contacts</h3>
            <p className="text-xs text-[color:var(--muted)]">
              Add and edit contacts shown in the crisis support modal.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
            onClick={() =>
              setCrisisContacts((current) => [
                ...current,
                {
                  label: "",
                  phone: "",
                  description: "",
                },
              ])
            }
          >
            Add contact
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {crisisContacts.map((entry, index) => (
            <div
              key={`crisis-contact-${index}`}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
            >
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium">Label</label>
                  <input
                    name="crisisContactLabel"
                    value={entry.label}
                    onChange={(event) =>
                      setCrisisContacts((current) =>
                        current.map((contact, contactIndex) =>
                          contactIndex === index
                            ? {
                                ...contact,
                                label: event.target.value,
                              }
                            : contact,
                        ),
                      )
                    }
                    className="w-full px-3 py-2"
                    placeholder="LIFELINE"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Phone</label>
                  <input
                    name="crisisContactPhone"
                    value={entry.phone}
                    onChange={(event) =>
                      setCrisisContacts((current) =>
                        current.map((contact, contactIndex) =>
                          contactIndex === index
                            ? {
                                ...contact,
                                phone: event.target.value,
                              }
                            : contact,
                        ),
                      )
                    }
                    className="w-full px-3 py-2"
                    placeholder="0808 808 8000"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium">Description</label>
                  <textarea
                    name="crisisContactDescription"
                    rows={2}
                    value={entry.description}
                    onChange={(event) =>
                      setCrisisContacts((current) =>
                        current.map((contact, contactIndex) =>
                          contactIndex === index
                            ? {
                                ...contact,
                                description: event.target.value,
                              }
                            : contact,
                        ),
                      )
                    }
                    className="w-full px-3 py-2"
                    placeholder="Optional supporting description."
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3 text-xs">
                <p className="text-[color:var(--muted)]">
                  Preview:{" "}
                  <span className="font-semibold text-[color:var(--foreground)]">
                    {entry.label || "Label"}
                  </span>
                  {entry.phone ? ` - ${entry.phone}` : ""}
                  {entry.description ? ` (${entry.description})` : ""}
                </p>
                <button
                  type="button"
                  className="rounded-md border border-[color:var(--border)] px-2 py-1 font-semibold hover:bg-[color:var(--accent-soft)]"
                  onClick={() =>
                    setCrisisContacts((current) => {
                      if (current.length <= 1) {
                        return [
                          {
                            label: "",
                            phone: "",
                            description: "",
                          },
                        ];
                      }

                      return current.filter((_, contactIndex) => contactIndex !== index);
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[color:var(--border)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Availability notes</h3>
            <p className="text-xs text-[color:var(--muted)]">
              Add and edit guidance notes shown in the availability step.
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[color:var(--accent-soft)]"
            onClick={() =>
              setAvailabilityNotes((current) => [
                ...current,
                {
                  title: "",
                  body: "",
                },
              ])
            }
          >
            Add note
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {availabilityNotes.map((entry, index) => (
            <div
              key={`availability-note-${index}`}
              className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3"
            >
              <div className="grid gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Title</label>
                  <input
                    name="availabilityNoteTitle"
                    value={entry.title}
                    onChange={(event) =>
                      setAvailabilityNotes((current) =>
                        current.map((note, noteIndex) =>
                          noteIndex === index
                            ? {
                                ...note,
                                title: event.target.value,
                              }
                            : note,
                        ),
                      )
                    }
                    className="w-full px-3 py-2"
                    placeholder="EVENING SESSIONS"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Body</label>
                  <textarea
                    name="availabilityNoteBody"
                    rows={3}
                    value={entry.body}
                    onChange={(event) =>
                      setAvailabilityNotes((current) =>
                        current.map((note, noteIndex) =>
                          noteIndex === index
                            ? {
                                ...note,
                                body: event.target.value,
                              }
                            : note,
                        ),
                      )
                    }
                    className="w-full px-3 py-2"
                    placeholder="Explain the guidance shown to clients."
                  />
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-[color:var(--border)] pt-3 text-xs">
                <p className="text-[color:var(--muted)]">
                  Preview:{" "}
                  <span className="font-semibold text-[color:var(--foreground)]">
                    {entry.title || "Title"}
                  </span>
                  {entry.body ? ` - ${entry.body}` : ""}
                </p>
                <button
                  type="button"
                  className="rounded-md border border-[color:var(--border)] px-2 py-1 font-semibold hover:bg-[color:var(--accent-soft)]"
                  onClick={() =>
                    setAvailabilityNotes((current) => {
                      if (current.length <= 1) {
                        return [
                          {
                            title: "",
                            body: "",
                          },
                        ];
                      }

                      return current.filter((_, noteIndex) => noteIndex !== index);
                    })
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
