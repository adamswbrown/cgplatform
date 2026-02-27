"use client";

import { FormEvent, useEffect, useRef, useState, type PointerEvent } from "react";

type SlotResponseFormProps = {
  caseId: string;
  accessKey: string;
  proposedStartTime: string;
  proposedEndTime: string;
};

type TocInfo = {
  caseId: string;
  participantEmail: string;
  participantName: string;
};

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function SlotResponseForm({
  caseId,
  accessKey,
  proposedStartTime,
  proposedEndTime,
}: SlotResponseFormProps) {
  const [mode, setMode] = useState<"choose" | "accept" | "toc" | "counter" | "done">("choose");
  const [tocAccepted, setTocAccepted] = useState(false);
  const [counterDate, setCounterDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [tocInfo, setTocInfo] = useState<TocInfo | null>(null);

  // ToC form state
  const [acceptedTermsDeclaration, setAcceptedTermsDeclaration] = useState(false);
  const [acceptedDataPolicy, setAcceptedDataPolicy] = useState(false);
  const [printedName, setPrintedName] = useState("");
  const [signedDate, setSignedDate] = useState(todayIsoDate());
  const [signatureType, setSignatureType] = useState<"typed" | "drawn">("typed");
  const [typedSignature, setTypedSignature] = useState("");
  const [drawnSignature, setDrawnSignature] = useState("");
  const [tocSubmitting, setTocSubmitting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (mode !== "toc" || signatureType !== "drawn") {
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
  }, [mode, signatureType]);

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

  async function handleAccept() {
    if (!tocAccepted) {
      setError("You must accept the Terms of Counselling to confirm this appointment.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/cases/${caseId}/slot/client-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept: true,
          tocAccepted: true,
          accessKey,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      // If the server returned ToC info, show the inline ToC form
      if (data.tocInfo) {
        setTocInfo(data.tocInfo);
        setMode("toc");
      } else {
        setSuccessMessage("Your appointment has been confirmed. You will receive a confirmation email shortly.");
        setMode("done");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleTocSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!acceptedTermsDeclaration) {
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

    setTocSubmitting(true);
    try {
      const res = await fetch(`/api/cases/${caseId}/toc-inline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantIdentifier: tocInfo!.participantEmail,
          accessKey,
          metadata: {
            acceptedTerms: acceptedTermsDeclaration,
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

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Submission failed.");
        return;
      }

      setSuccessMessage(
        "Your appointment has been confirmed and Terms of Counselling signed. You will receive a confirmation email shortly.",
      );
      setMode("done");
    } catch {
      setError("Submission failed. Please try again.");
    } finally {
      setTocSubmitting(false);
    }
  }

  function handleSkipToc() {
    setSuccessMessage(
      "Your appointment has been confirmed. You will receive an email with a link to sign the Terms of Counselling.",
    );
    setMode("done");
  }

  async function handleCounterPropose() {
    if (!counterDate) {
      setError("Please select a date for your proposed alternative.");
      return;
    }

    setLoading(true);
    setError(null);

    // Keep the same time of day from the original proposal, but use the new date
    const originalStart = new Date(proposedStartTime);
    const originalEnd = new Date(proposedEndTime);
    const newDate = new Date(counterDate);

    const counterStart = new Date(newDate);
    counterStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);

    const counterEnd = new Date(newDate);
    counterEnd.setHours(originalEnd.getHours(), originalEnd.getMinutes(), 0, 0);

    try {
      const res = await fetch(`/api/cases/${caseId}/slot/client-respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accept: false,
          counterProposedStartTime: counterStart.toISOString(),
          counterProposedEndTime: counterEnd.toISOString(),
          accessKey,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }

      setSuccessMessage("Your alternative date has been sent. The counsellor will review and you will be contacted with a confirmation.");
      setMode("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "done") {
    return (
      <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5">
        <p className="text-sm font-semibold text-green-800">{successMessage}</p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {mode === "choose" ? (
        <div className="space-y-3">
          <button
            onClick={() => setMode("accept")}
            className="w-full rounded-lg bg-green-600 px-4 py-3 text-sm font-semibold text-white hover:bg-green-700"
          >
            Accept this appointment
          </button>
          <button
            onClick={() => setMode("counter")}
            className="w-full rounded-lg border border-[color:var(--border)] px-4 py-3 text-sm font-semibold hover:bg-[color:var(--accent-soft)]"
          >
            Propose a different day
          </button>
        </div>
      ) : null}

      {mode === "accept" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-[color:var(--border)] p-4">
            <h3 className="text-sm font-semibold">Terms of Counselling</h3>
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              By accepting this appointment, you agree to the Terms of Counselling as provided by Christian Guidelines.
              You will be asked to read and sign the full terms after confirming.
            </p>
            <label className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={tocAccepted}
                onChange={(e) => setTocAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm">
                I agree to the Terms of Counselling
              </span>
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAccept}
              disabled={loading}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? "Confirming..." : "Confirm appointment"}
            </button>
            <button
              onClick={() => setMode("choose")}
              disabled={loading}
              className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}

      {mode === "toc" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-800">
              Appointment confirmed! Please now sign the Terms of Counselling below.
            </p>
            <p className="mt-1 text-xs text-green-700">
              You can also complete this later via the link in your confirmation email.
            </p>
          </div>

          <div className="rounded-xl border border-[color:var(--border)] bg-[#efeff8] p-4">
            <h3 className="text-lg font-semibold">Terms of Counselling</h3>
            <div className="mt-3 max-h-[400px] overflow-y-auto rounded-xl bg-white p-4">
              <pre className="whitespace-pre-wrap font-sans text-xs leading-5">
                {TERMS_OF_COUNSELLING_SUMMARY}
              </pre>
            </div>
          </div>

          <form onSubmit={handleTocSubmit} className="space-y-4">
            <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-4">
              <p className="text-sm font-semibold">Client Declaration</p>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acceptedTermsDeclaration}
                  onChange={(e) => setAcceptedTermsDeclaration(e.target.checked)}
                  className="mt-0.5"
                />
                I agree to the terms set out in this document and will co-operate, to the best
                of my ability, with my Counsellor.
              </label>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={acceptedDataPolicy}
                  onChange={(e) => setAcceptedDataPolicy(e.target.checked)}
                  className="mt-0.5"
                />
                I give explicit consent for my Counsellor to gather and record such Special
                Category Information as might be considered essential to this process of counselling.
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="toc-printed-name" className="mb-1 block text-sm font-medium">
                  Printed name *
                </label>
                <input
                  id="toc-printed-name"
                  value={printedName}
                  onChange={(e) => setPrintedName(e.target.value)}
                  className="w-full rounded-lg border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="toc-date" className="mb-1 block text-sm font-medium">
                  Date *
                </label>
                <input
                  id="toc-date"
                  type="date"
                  value={signedDate}
                  onChange={(e) => setSignedDate(e.target.value)}
                  className="w-full rounded-lg border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="rounded-xl border border-[color:var(--border)] p-4">
              <p className="text-sm font-semibold">Signature *</p>
              <div className="mt-2 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="toc-signature-type"
                    checked={signatureType === "typed"}
                    onChange={() => setSignatureType("typed")}
                  />
                  Typed signature
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="toc-signature-type"
                    checked={signatureType === "drawn"}
                    onChange={() => setSignatureType("drawn")}
                  />
                  Drawn signature
                </label>
              </div>

              {signatureType === "typed" ? (
                <input
                  value={typedSignature}
                  onChange={(e) => setTypedSignature(e.target.value)}
                  placeholder="Type your full signature"
                  className="mt-3 w-full rounded-lg border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
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
                    className="mt-2 rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-xs hover:bg-[color:var(--accent-soft)]"
                  >
                    Clear signature
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={tocSubmitting}
                className="rounded-lg bg-[color:var(--cg-ink)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {tocSubmitting ? "Submitting..." : "Sign Terms of Counselling"}
              </button>
              <button
                type="button"
                onClick={handleSkipToc}
                className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm hover:bg-[color:var(--accent-soft)]"
              >
                Sign later via email
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {mode === "counter" ? (
        <div className="space-y-4">
          <div>
            <label htmlFor="counterDate" className="block text-sm font-medium">
              Propose a different day (same time)
            </label>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              The session will be at the same time of day, just on a different date.
            </p>
            <input
              type="date"
              id="counterDate"
              value={counterDate}
              onChange={(e) => setCounterDate(e.target.value)}
              min={new Date().toISOString().split("T")[0]}
              className="mt-2 w-full rounded-lg border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleCounterPropose}
              disabled={loading}
              className="rounded-lg bg-[color:var(--accent)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Submit alternative date"}
            </button>
            <button
              onClick={() => setMode("choose")}
              disabled={loading}
              className="rounded-lg border border-[color:var(--border)] px-4 py-2 text-sm hover:bg-[color:var(--accent-soft)] disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// Condensed version of the terms for inline display
const TERMS_OF_COUNSELLING_SUMMARY = `Welcome to Christian Guidelines. It is important that you should be aware of, and agree to, the terms under which we operate our Counselling Service.

As an organisation, all our Counsellors are required to adhere to a strict code of ethics as set out by the ACC (Association of Christian Counsellors & Linked Professions) and BACP (British Association for Counselling and Psychotherapy).

It is our policy not to counsel clients who are currently engaged in counselling with another organisation or receiving psychological support elsewhere.

In order to make counselling accessible to all, we offer a donation based approach. This is based on a minimum donation of \u00A310 per session.

APPOINTMENTS:
1. Counselling appointments are normally for no more than one hour, so punctuality is particularly important.

FOR TELEPHONE/ONLINE SESSIONS:
If your session is being conducted online or by telephone, please be available to connect with your Counsellor at the agreed time in a safe and private place.

2. Audio and video recording for sessions is prohibited without written consent of both parties.

3. The effectiveness of the counselling process will be reviewed after 6 sessions.

APPOINTMENT CANCELLATION POLICY:
4. Please give at least 24 hours notice to cancel. Contact: 028-91468846, text/WhatsApp 07715215737, or email admin@cguidelines.org.uk.

OTHER COMMUNICATION:
5-7. Your Counsellor may send therapy-enhancing resources. Administrative staff may contact you for scheduling purposes. Do not use electronic methods for sensitive content.

TERMINATION OF COUNSELLING POLICY:
8-10. You may terminate counselling at any time with notice. Three missed appointments without notice will lead to termination.

RESPONSIBILITY/LIABILITY:
11-12. Christian Guidelines cannot accept responsibility for your response to counselling. Choices and changes are made by you.

CONFIDENTIALITY:
13. Confidentiality cannot be guaranteed if there is serious risk to yourself or others, evidence of a serious criminal offence, or risk involving a minor or vulnerable adult.

RECORD-KEEPING & GDPR:
14-16. Summary notes are retained for three years following your final session. You are entitled to see any notes relating to you.

PRIVACY POLICY:
17. Available at: https://www.christianguidelines.org/privacy-policy

CONCERNS OR COMPLAINTS:
18-19. Please raise concerns with your Counsellor. Details of our Complaints Procedure are available on request.

CHRISTIAN GUIDELINES LTD
2nd Floor The Link, 10 West St, Newtownards. BT23 4EN.
Tel: 028 9146 8846 | Email: admin@cguidelines.org.uk`;
