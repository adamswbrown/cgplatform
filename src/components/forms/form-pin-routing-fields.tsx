"use client";

import { useMemo, useState } from "react";

const FORM_TYPE_TO_DEFAULT_PATH: Record<string, string> = {
  INTAKE_FORM: "/intake",
  TERMS_AND_CONDITIONS: "/forms/terms-and-conditions",
  CONSENT_FORM: "/forms/consent",
  AGREEMENT_FORM: "/forms/agreement",
  OUTTAKE_FORM: "/forms/outtake",
};

const FORM_TYPE_OPTIONS = [
  "INTAKE_FORM",
  "TERMS_AND_CONDITIONS",
  "CONSENT_FORM",
  "AGREEMENT_FORM",
  "OUTTAKE_FORM",
] as const;

type FormPinRoutingFieldsProps = {
  initialFormType?: string;
  initialFormPath?: string;
};

export function FormPinRoutingFields({
  initialFormType = "INTAKE_FORM",
  initialFormPath,
}: FormPinRoutingFieldsProps) {
  const safeInitialType = FORM_TYPE_OPTIONS.includes(initialFormType as (typeof FORM_TYPE_OPTIONS)[number])
    ? initialFormType
    : "INTAKE_FORM";
  const defaultPathForType = FORM_TYPE_TO_DEFAULT_PATH[safeInitialType] ?? "/forms/terms-and-conditions";
  const [formType, setFormType] = useState(safeInitialType);
  const [formPath, setFormPath] = useState(initialFormPath?.trim() || defaultPathForType);

  const pathOptions = useMemo(
    () => Array.from(new Set(Object.values(FORM_TYPE_TO_DEFAULT_PATH))),
    [],
  );

  return (
    <>
      <label htmlFor="formTypePin" className="block text-xs font-medium">
        Form type
      </label>
      <select
        id="formTypePin"
        name="formType"
        value={formType}
        onChange={(event) => {
          const nextType = event.target.value;
          setFormType(nextType);
          setFormPath(FORM_TYPE_TO_DEFAULT_PATH[nextType] ?? "/forms/terms-and-conditions");
        }}
        className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
      >
        {FORM_TYPE_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <label htmlFor="formPathPin" className="block text-xs font-medium">
        Form path
      </label>
      <input
        id="formPathPin"
        name="formPath"
        value={formPath}
        onChange={(event) => setFormPath(event.target.value)}
        list="form-path-options"
        className="w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
        required
      />
      <datalist id="form-path-options">
        {pathOptions.map((pathOption) => (
          <option key={pathOption} value={pathOption} />
        ))}
      </datalist>
    </>
  );
}
