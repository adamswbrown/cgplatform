"use client";

import { FormEvent, useEffect, useRef, useState, type PointerEvent } from "react";

type TermsOfCounsellingFormProps = {
  caseId: string;
  participantIdentifier: string;
  accessKey: string;
  successMessage?: string;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function TermsOfCounsellingForm({
  caseId,
  participantIdentifier,
  accessKey,
  successMessage = "Thank you. Your terms response has been recorded.",
}: TermsOfCounsellingFormProps) {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedDataPolicy, setAcceptedDataPolicy] = useState(false);
  const [printedName, setPrintedName] = useState("");
  const [signedDate, setSignedDate] = useState(todayIsoDate());
  const [signatureType, setSignatureType] = useState<"typed" | "drawn">("typed");
  const [typedSignature, setTypedSignature] = useState("");
  const [drawnSignature, setDrawnSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (signatureType !== "drawn") {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#052E1E";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
  }, [signatureType]);

  const beginDraw = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    drawingRef.current = true;
    const rect = canvas.getBoundingClientRect();
    context.beginPath();
    context.moveTo(event.clientX - rect.left, event.clientY - rect.top);
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    context.lineTo(event.clientX - rect.left, event.clientY - rect.top);
    context.stroke();
  };

  const endDraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    drawingRef.current = false;
    setDrawnSignature(canvas.toDataURL("image/png"));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setDrawnSignature("");
  };

  const signatureValue = signatureType === "typed" ? typedSignature.trim() : drawnSignature;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!acceptedTerms) {
      setError("Please confirm you agree to the terms of counselling.");
      return;
    }
    if (!acceptedDataPolicy) {
      setError("Please confirm your consent for Special Category Information.");
      return;
    }
    if (!printedName.trim()) {
      setError("Please enter your printed name.");
      return;
    }
    if (!signedDate) {
      setError("Please provide the signed date.");
      return;
    }
    if (!signatureValue) {
      setError("Please provide your signature.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/forms/submission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          formType: "TERMS_AND_CONDITIONS",
          caseId,
          participantIdentifier,
          accessKey,
          source: "secure_form_pin",
          metadata: {
            acceptedTerms,
            acceptedDataPolicy,
            printedName: printedName.trim(),
            signedDate,
            signatureType,
            signature: signatureValue,
            submittedAt: new Date().toISOString(),
            termsVersion: "terms_of_counselling_v1",
          },
        }),
      });

      const json = (await response.json()) as {
        ok: boolean;
        error?: string;
      };

      if (!response.ok || !json.ok) {
        setError(json.error || "Submission failed.");
        return;
      }

      setSubmitted(true);
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        {successMessage}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-4">
        <p className="text-sm font-semibold">Client Declaration</p>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          Please confirm each declaration before submitting.
        </p>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            id="terms-accepted"
            type="checkbox"
            checked={acceptedTerms}
            onChange={(event) => setAcceptedTerms(event.target.checked)}
            className="mt-0.5"
          />
          I agree to the terms set out in this document and will co-operate, to the best
          of my ability, with my Counsellor.
        </label>

        <label className="mt-3 flex items-start gap-2 text-sm">
          <input
            id="terms-data-policy"
            type="checkbox"
            checked={acceptedDataPolicy}
            onChange={(event) => setAcceptedDataPolicy(event.target.checked)}
            className="mt-0.5"
          />
          I give explicit consent for my Counsellor to gather and record such Special
          Category Information as might be considered essential to this process of counselling.
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="terms-printed-name" className="mb-1 block text-sm font-medium">
            Printed name *
          </label>
          <input
            id="terms-printed-name"
            value={printedName}
            onChange={(event) => setPrintedName(event.target.value)}
            className="w-full px-3 py-2"
          />
        </div>
        <div>
          <label htmlFor="terms-date" className="mb-1 block text-sm font-medium">
            Date *
          </label>
          <input
            id="terms-date"
            type="date"
            value={signedDate}
            onChange={(event) => setSignedDate(event.target.value)}
            className="w-full px-3 py-2"
          />
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border)] p-4">
        <p className="text-sm font-semibold">Signature *</p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="terms-signature-type"
              checked={signatureType === "typed"}
              onChange={() => setSignatureType("typed")}
            />
            Typed signature
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="terms-signature-type"
              checked={signatureType === "drawn"}
              onChange={() => setSignatureType("drawn")}
            />
            Drawn signature
          </label>
        </div>

        {signatureType === "typed" ? (
          <input
            id="terms-signature-typed"
            value={typedSignature}
            onChange={(event) => setTypedSignature(event.target.value)}
            placeholder="Type your full signature"
            className="mt-3 w-full px-3 py-2"
          />
        ) : (
          <div className="mt-3">
            <canvas
              ref={canvasRef}
              width={760}
              height={160}
              onPointerDown={beginDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerLeave={endDraw}
              className="w-full rounded-xl border border-[color:var(--border)] bg-white"
            />
            <button
              type="button"
              onClick={clearSignature}
              className="cg-cta-secondary mt-2 px-3 py-1.5 text-xs"
            >
              Clear signature
            </button>
          </div>
        )}
      </div>

      {error ? (
        <p className="rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full border border-[color:var(--border)] px-4 py-2 text-sm font-medium"
        >
          Preview PDF
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-full bg-[color:var(--cg-ink)] px-5 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Submit"}
        </button>
      </div>
    </form>
  );
}
