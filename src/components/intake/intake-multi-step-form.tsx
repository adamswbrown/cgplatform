"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  CONTACT_PREFERENCE_ROWS,
  HEARD_ABOUT_OPTIONS,
  LOCATION_OPTIONS,
  PRESENTING_ISSUE_OPTIONS,
  TIME_PREFERENCE_OPTIONS,
} from "@/lib/intake-form";
import type { IntakeFormContent } from "@/lib/intake-settings";

type IntakeMultiStepFormProps = {
  content: IntakeFormContent;
  initialError?: string | null;
  accessKey: string;
  assignmentMode: "manual" | "auto";
};

type PublicAvailabilitySlot = {
  specialistId: string;
  specialistName: string;
  startTime: string;
  endTime: string;
};

type YesNo = "yes" | "no";

const STEP_TITLES = ["Application", "Presenting Issue", "Availability"] as const;

const defaultContactPreferences = {
  contactMainPhone: "yes" as YesNo,
  leaveVoicemailMainPhone: "no" as YesNo,
  contactSecondPhone: "no" as YesNo,
  leaveVoicemailSecondPhone: "no" as YesNo,
  contactEmail: "yes" as YesNo,
};

function toLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSlotLabel(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${start.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  })} • ${start.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} - ${end.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function SignatureCapture({
  signatureType,
  setSignatureType,
  typedSignature,
  setTypedSignature,
  drawnSignature,
  setDrawnSignature,
}: {
  signatureType: "typed" | "drawn";
  setSignatureType: (value: "typed" | "drawn") => void;
  typedSignature: string;
  setTypedSignature: (value: string) => void;
  drawnSignature: string;
  setDrawnSignature: (value: string) => void;
}) {
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

    context.fillStyle = "#fff";
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

  const clearDrawnSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    setDrawnSignature("");
  };

  const hasSignature = signatureType === "typed" ? typedSignature.trim().length > 0 : drawnSignature.length > 0;

  return (
    <div className="space-y-3 rounded-2xl border border-[color:var(--border)] p-4">
      <div>
        <p className="text-sm font-medium">Consent & Signature *</p>
        <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">
          By providing your signature, you confirm that the information you provide is accurate and that you consent to us using it to arrange your counselling.
        </p>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="signatureType"
            checked={signatureType === "typed"}
            onChange={() => setSignatureType("typed")}
          />
          Typed signature
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="signatureType"
            checked={signatureType === "drawn"}
            onChange={() => setSignatureType("drawn")}
          />
          Drawn signature
        </label>
      </div>

      {signatureType === "typed" ? (
        <input
          value={typedSignature}
          onChange={(event) => setTypedSignature(event.target.value)}
          placeholder="Type your full name as signature"
          className="w-full px-3 py-2"
        />
      ) : (
        <div>
          <canvas
            ref={canvasRef}
            width={760}
            height={160}
            onPointerDown={beginDraw}
            onPointerMove={draw}
            onPointerUp={endDraw}
            onPointerLeave={endDraw}
            className="cg-signature-canvas w-full"
          />
          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              onClick={clearDrawnSignature}
              className="cg-cta-secondary px-3 py-1.5 text-xs"
            >
              Clear Signature
            </button>
            {drawnSignature ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--cg-dark-accent)]">
                <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" /></svg>
                Signature captured
              </span>
            ) : null}
          </div>
        </div>
      )}

      {signatureType === "typed" && hasSignature ? (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[color:var(--cg-dark-accent)]">
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5"><path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" /></svg>
          Signature recorded
        </span>
      ) : null}
    </div>
  );
}

export function IntakeMultiStepForm({
  content,
  initialError,
  accessKey,
  assignmentMode,
}: IntakeMultiStepFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(initialError || null);
  const [submitting, setSubmitting] = useState(false);

  const [counsellingType, setCounsellingType] = useState<"individual" | "couples">("individual");
  const [signatureType, setSignatureType] = useState<"typed" | "drawn">("typed");
  const [typedSignature, setTypedSignature] = useState("");
  const [drawnSignature, setDrawnSignature] = useState("");

  const [primaryTitle, setPrimaryTitle] = useState("");
  const [primaryFirstName, setPrimaryFirstName] = useState("");
  const [primaryLastName, setPrimaryLastName] = useState("");
  const [primaryDateOfBirth, setPrimaryDateOfBirth] = useState("");
  const [primaryGender, setPrimaryGender] = useState<"female" | "male">("female");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primaryMainPhone, setPrimaryMainPhone] = useState("");
  const [primarySecondPhone, setPrimarySecondPhone] = useState("");
  const [primaryAddressLine1, setPrimaryAddressLine1] = useState("");
  const [primaryAddressLine2, setPrimaryAddressLine2] = useState("");
  const [primaryCity, setPrimaryCity] = useState("");
  const [primaryCounty, setPrimaryCounty] = useState("");
  const [primaryPostcode, setPrimaryPostcode] = useState("");
  const [primaryCountryIfNotUk, setPrimaryCountryIfNotUk] = useState("");
  const [heardAbout, setHeardAbout] = useState<(typeof HEARD_ABOUT_OPTIONS)[number]>("WEBSITE");
  const [heardAboutOtherDetail, setHeardAboutOtherDetail] = useState("");
  const [churchConnection, setChurchConnection] = useState<"yes" | "no" | "prefer_not_to_say">("no");
  const [leadershipRole, setLeadershipRole] = useState<"yes" | "no" | "prefer_not_to_say">("no");
  const [contactPreferences, setContactPreferences] = useState(defaultContactPreferences);
  const [emergencyFirstName, setEmergencyFirstName] = useState("");
  const [emergencyLastName, setEmergencyLastName] = useState("");
  const [emergencyRelationship, setEmergencyRelationship] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [gpSurgeryName, setGpSurgeryName] = useState("");
  const [gpSurgeryPhone, setGpSurgeryPhone] = useState("");
  const [gpDoctorName, setGpDoctorName] = useState("");

  const [secondaryTitle, setSecondaryTitle] = useState("");
  const [secondaryFirstName, setSecondaryFirstName] = useState("");
  const [secondaryLastName, setSecondaryLastName] = useState("");
  const [secondaryDateOfBirth, setSecondaryDateOfBirth] = useState("");
  const [secondaryGender, setSecondaryGender] = useState<"female" | "male">("female");
  const [secondaryEmail, setSecondaryEmail] = useState("");
  const [secondaryMainPhone, setSecondaryMainPhone] = useState("");

  const [mainIssue, setMainIssue] = useState<(typeof PRESENTING_ISSUE_OPTIONS)[number]>("ANXIETY_STRESS");
  const [mainIssueOtherDetail, setMainIssueOtherDetail] = useState("");
  const [issueDuration, setIssueDuration] = useState("");
  const [previousSupport, setPreviousSupport] = useState<YesNo>("no");
  const [previousSupportDetails, setPreviousSupportDetails] = useState("");
  const [suicidalThoughtsRecently, setSuicidalThoughtsRecently] = useState<YesNo>("no");
  const [suicidalThoughtsDetails, setSuicidalThoughtsDetails] = useState("");
  const [attemptedSuicide, setAttemptedSuicide] = useState<YesNo>("no");
  const [attemptedSuicideDetails, setAttemptedSuicideDetails] = useState("");

  const [location, setLocation] = useState<(typeof LOCATION_OPTIONS)[number]>("NEWTOWNARDS");
  const [includeOnline, setIncludeOnline] = useState(false);
  const [timePreferences, setTimePreferences] = useState<(typeof TIME_PREFERENCE_OPTIONS)[number][]>([]);
  const [availabilityNotes, setAvailabilityNotes] = useState("");
  const [availabilitySlots, setAvailabilitySlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedSlotKeys, setSelectedSlotKeys] = useState<string[]>([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const participantType = counsellingType === "couples" ? "couple" : "single";
  const currentSignature = signatureType === "typed" ? typedSignature.trim() : drawnSignature;

  useEffect(() => {
    if (assignmentMode !== "auto") {
      setAvailabilitySlots([]);
      setAvailabilityError(null);
      setAvailabilityLoading(false);
      setSelectedSlotKeys([]);
      return;
    }

    const controller = new AbortController();
    const load = async () => {
      setAvailabilityLoading(true);
      setAvailabilityError(null);

      try {
        const response = await fetch(
          `/api/public-availability?counsellingType=${encodeURIComponent(counsellingType)}&limit=24&location=${encodeURIComponent(location)}&includeOnline=${includeOnline ? "true" : "false"}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const json = (await response.json()) as {
          ok: boolean;
          data?: { slots: PublicAvailabilitySlot[] };
          error?: string;
        };

        if (!response.ok || !json.ok) {
          setAvailabilitySlots([]);
          setAvailabilityError(json.error || "Availability options are not available right now.");
          return;
        }

        setAvailabilitySlots(json.data?.slots || []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setAvailabilitySlots([]);
          setAvailabilityError("Availability options are not available right now.");
        }
      } finally {
        setAvailabilityLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [assignmentMode, counsellingType, includeOnline, location]);

  const selectedSlots = useMemo(() => {
    const selected = new Set(selectedSlotKeys);
    return availabilitySlots.filter((slot) => selected.has(`${slot.startTime}|${slot.endTime}`));
  }, [availabilitySlots, selectedSlotKeys]);

  const toggleSlot = (slot: PublicAvailabilitySlot) => {
    const key = `${slot.startTime}|${slot.endTime}`;
    setSelectedSlotKeys((current) =>
      current.includes(key) ? current.filter((value) => value !== key) : [...current, key],
    );
  };

  const toggleTimePreference = (preference: (typeof TIME_PREFERENCE_OPTIONS)[number]) => {
    setTimePreferences((current) =>
      current.includes(preference)
        ? current.filter((entry) => entry !== preference)
        : [...current, preference],
    );
  };

  const validateCurrentStep = () => {
    if (step === 0) {
      if (!currentSignature) {
        return "Consent signature is required.";
      }
      if (
        !primaryTitle ||
        !primaryFirstName ||
        !primaryLastName ||
        !primaryDateOfBirth ||
        !primaryEmail ||
        !primaryMainPhone ||
        !primaryAddressLine1 ||
        !primaryCity ||
        !primaryPostcode ||
        !emergencyFirstName ||
        !emergencyLastName ||
        !emergencyRelationship ||
        !emergencyPhone ||
        !gpSurgeryName ||
        !gpSurgeryPhone
      ) {
        return "Please complete all required fields on this step.";
      }

      if (heardAbout === "OTHER" && !heardAboutOtherDetail.trim()) {
        return "Please provide details for 'how you heard about Christian Guidelines'.";
      }

      if (participantType === "couple") {
        if (
          !secondaryTitle ||
          !secondaryFirstName ||
          !secondaryLastName ||
          !secondaryDateOfBirth ||
          !secondaryEmail ||
          !secondaryMainPhone
        ) {
          return "Please complete all required secondary participant fields for couples.";
        }
      }
    }

    if (step === 1) {
      if (!issueDuration.trim()) {
        return "Please provide how long the main presenting issue has been affecting you.";
      }
      if (mainIssue === "OTHER" && !mainIssueOtherDetail.trim()) {
        return "Please provide details for presenting issue 'OTHER'.";
      }
      if (previousSupport === "yes" && !previousSupportDetails.trim()) {
        return "Please provide previous support details.";
      }
      if (suicidalThoughtsRecently === "yes" && !suicidalThoughtsDetails.trim()) {
        return "Please provide details about recent suicidal thoughts.";
      }
      if (attemptedSuicide === "yes" && !attemptedSuicideDetails.trim()) {
        return "Please provide details about attempted suicide.";
      }
    }

    if (step === 2) {
      if (!location || !availabilityNotes.trim()) {
        return "Please choose a location and provide your availability notes.";
      }
      if (timePreferences.length === 0) {
        return "Please select at least one preferred time of day.";
      }
      if (assignmentMode === "auto" && availabilitySlots.length > 0 && selectedSlots.length === 0) {
        return "Please select at least one availability slot from the availability widget.";
      }
    }

    return null;
  };

  const nextStep = () => {
    const error = validateCurrentStep();
    if (error) {
      setSubmitError(error);
      return;
    }
    setSubmitError(null);
    setStep((current) => Math.min(current + 1, STEP_TITLES.length - 1));
  };

  const previousStep = () => {
    setSubmitError(null);
    setStep((current) => Math.max(current - 1, 0));
  };

  const submit = async () => {
    const error = validateCurrentStep();
    if (error) {
      setSubmitError(error);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessKey,
          participantType,
          counsellingType,
          consent: {
            signature: currentSignature,
            signatureType,
            signedAt: new Date().toISOString(),
          },
          primary: {
            title: primaryTitle,
            firstName: primaryFirstName,
            lastName: primaryLastName,
            dateOfBirth: primaryDateOfBirth,
            gender: primaryGender,
            email: primaryEmail,
            mainPhone: primaryMainPhone,
            secondPhone: primarySecondPhone,
            addressLine1: primaryAddressLine1,
            addressLine2: primaryAddressLine2,
            city: primaryCity,
            county: primaryCounty,
            postcode: primaryPostcode,
            countryIfNotUk: primaryCountryIfNotUk,
            churchConnection,
            leadershipRole,
            heardAbout,
            heardAboutOtherDetail,
            contactPreferences,
            emergencyContactFirstName: emergencyFirstName,
            emergencyContactLastName: emergencyLastName,
            emergencyRelationship,
            emergencyPhone,
            gpSurgeryName,
            gpSurgeryPhone,
            gpDoctorName,
          },
          secondary:
            participantType === "couple"
              ? {
                  title: secondaryTitle,
                  firstName: secondaryFirstName,
                  lastName: secondaryLastName,
                  dateOfBirth: secondaryDateOfBirth,
                  gender: secondaryGender,
                  email: secondaryEmail,
                  mainPhone: secondaryMainPhone,
                }
              : {},
          presenting: {
            mainIssue,
            otherDetails: mainIssueOtherDetail,
            issueDuration,
            previousSupport,
            previousSupportDetails,
            suicidalThoughtsRecently,
            suicidalThoughtsDetails,
            attemptedSuicide,
            attemptedSuicideDetails,
          },
          availability: {
            location,
            includeOnline,
            notes: availabilityNotes,
            timePreferences,
            selectedSlots:
              assignmentMode === "auto"
                ? selectedSlots.map((slot) => ({
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                  }))
                : [],
          },
        }),
      });

      const json = (await response.json()) as {
        ok: boolean;
        data?: { caseId: string; reference: string; allocationError?: string | null };
        error?: string;
      };

      if (!response.ok || !json.ok || !json.data) {
        setSubmitError(json.error || "Failed to submit intake form.");
        return;
      }

      const query = new URLSearchParams({
        case: json.data.reference,
        caseId: json.data.caseId,
      });
      if (json.data.allocationError) {
        query.set("allocation", json.data.allocationError);
      }
      router.push(`/intake/success?${query.toString()}`);
    } catch {
      setSubmitError("Failed to submit intake form.");
    } finally {
      setSubmitting(false);
    }
  };

  const errorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (submitError && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [submitError]);

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
        <div className="cg-progress-bar">
          {STEP_TITLES.map((title, index) => {
            const isCompleted = index < step;
            const isActive = index === step;
            const stepClass = isCompleted
              ? "cg-progress-step cg-progress-step-completed"
              : isActive
                ? "cg-progress-step cg-progress-step-active"
                : "cg-progress-step";
            return (
              <div key={title} className={stepClass}>
                <div className="cg-progress-indicator">
                  {isCompleted ? (
                    <svg aria-hidden="true" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3"><path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" /></svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span className="cg-progress-label">{title}</span>
              </div>
            );
          })}
        </div>
      </div>

      {submitError ? (
        <div ref={errorRef} className="cg-alert cg-alert-error">
          {submitError}
        </div>
      ) : null}

      {step === 0 ? (
        <section className="space-y-5">
          <p className="text-sm text-[color:var(--muted)]">
            Application for counselling. Complete all required details before progressing.
          </p>

          <SignatureCapture
            signatureType={signatureType}
            setSignatureType={setSignatureType}
            typedSignature={typedSignature}
            setTypedSignature={setTypedSignature}
            drawnSignature={drawnSignature}
            setDrawnSignature={setDrawnSignature}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="counsellingType" className="mb-1 block text-sm font-medium">
                Are you applying for individual or couples counselling? *
              </label>
              <select
                id="counsellingType"
                value={counsellingType}
                onChange={(event) => setCounsellingType(event.target.value as "individual" | "couples")}
                className="w-full px-3 py-2"
              >
                <option value="individual">Individual</option>
                <option value="couples">Couples</option>
              </select>
            </div>
            <div>
              <label htmlFor="heardAbout" className="mb-1 block text-sm font-medium">
                How did you hear about Christian Guidelines? *
              </label>
              <select
                id="heardAbout"
                value={heardAbout}
                onChange={(event) => setHeardAbout(event.target.value as (typeof HEARD_ABOUT_OPTIONS)[number])}
                className="w-full px-3 py-2"
              >
                {HEARD_ABOUT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {toLabel(option)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {heardAbout === "OTHER" ? (
            <div>
              <label htmlFor="heardAboutOther" className="mb-1 block text-sm font-medium">
                If &quot;Other&quot;, please give detail *
              </label>
              <textarea
                id="heardAboutOther"
                rows={3}
                maxLength={1000}
                value={heardAboutOtherDetail}
                onChange={(event) => setHeardAboutOtherDetail(event.target.value)}
                className="w-full px-3 py-2"
              />
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Do you have a church connection? *</label>
              <select
                value={churchConnection}
                onChange={(event) =>
                  setChurchConnection(event.target.value as "yes" | "no" | "prefer_not_to_say")
                }
                className="w-full px-3 py-2"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Are you in a leadership role in church? *</label>
              <select
                value={leadershipRole}
                onChange={(event) =>
                  setLeadershipRole(event.target.value as "yes" | "no" | "prefer_not_to_say")
                }
                className="w-full px-3 py-2"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] p-4">
            <p className="text-sm font-semibold">Primary participant details *</p>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <input placeholder="Title (Mr, Mrs, Rev, Dr)" value={primaryTitle} onChange={(event) => setPrimaryTitle(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="First name" value={primaryFirstName} onChange={(event) => setPrimaryFirstName(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="Surname" value={primaryLastName} onChange={(event) => setPrimaryLastName(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="Date of birth" value={primaryDateOfBirth} onChange={(event) => setPrimaryDateOfBirth(event.target.value)} className="w-full px-3 py-2" />
              <select value={primaryGender} onChange={(event) => setPrimaryGender(event.target.value as "female" | "male")} className="w-full px-3 py-2">
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
              <input type="email" placeholder="Email" value={primaryEmail} onChange={(event) => setPrimaryEmail(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="Main contact phone number" value={primaryMainPhone} onChange={(event) => setPrimaryMainPhone(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="2nd contact phone number" value={primarySecondPhone} onChange={(event) => setPrimarySecondPhone(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="Address line 1" value={primaryAddressLine1} onChange={(event) => setPrimaryAddressLine1(event.target.value)} className="w-full px-3 py-2 md:col-span-2" />
              <input placeholder="Address line 2" value={primaryAddressLine2} onChange={(event) => setPrimaryAddressLine2(event.target.value)} className="w-full px-3 py-2 md:col-span-2" />
              <input placeholder="Town/City" value={primaryCity} onChange={(event) => setPrimaryCity(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="County" value={primaryCounty} onChange={(event) => setPrimaryCounty(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="Postcode" value={primaryPostcode} onChange={(event) => setPrimaryPostcode(event.target.value)} className="w-full px-3 py-2" />
              <input placeholder="Country of residence (if not UK)" value={primaryCountryIfNotUk} onChange={(event) => setPrimaryCountryIfNotUk(event.target.value)} className="w-full px-3 py-2" />
            </div>
          </div>

          {participantType === "couple" ? (
            <div className="rounded-2xl border border-[color:var(--border)] p-4">
              <p className="text-sm font-semibold">Secondary participant details *</p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <input placeholder="Title" value={secondaryTitle} onChange={(event) => setSecondaryTitle(event.target.value)} className="w-full px-3 py-2" />
                <input placeholder="First name" value={secondaryFirstName} onChange={(event) => setSecondaryFirstName(event.target.value)} className="w-full px-3 py-2" />
                <input placeholder="Surname" value={secondaryLastName} onChange={(event) => setSecondaryLastName(event.target.value)} className="w-full px-3 py-2" />
                <input placeholder="Date of birth" value={secondaryDateOfBirth} onChange={(event) => setSecondaryDateOfBirth(event.target.value)} className="w-full px-3 py-2" />
                <select value={secondaryGender} onChange={(event) => setSecondaryGender(event.target.value as "female" | "male")} className="w-full px-3 py-2">
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                </select>
                <input type="email" placeholder="Email" value={secondaryEmail} onChange={(event) => setSecondaryEmail(event.target.value)} className="w-full px-3 py-2" />
                <input placeholder="Main contact phone number" value={secondaryMainPhone} onChange={(event) => setSecondaryMainPhone(event.target.value)} className="w-full px-3 py-2 md:col-span-2" />
              </div>
            </div>
          ) : null}

          <div className="rounded-2xl border border-[color:var(--border)] p-4">
            <p className="text-sm font-semibold">How may we contact you?</p>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-2 py-1 text-left font-medium">Contact method</th>
                    <th className="px-2 py-1 text-center font-medium">Yes</th>
                    <th className="px-2 py-1 text-center font-medium">No</th>
                  </tr>
                </thead>
                <tbody>
                  {CONTACT_PREFERENCE_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td className="px-2 py-2">{row.label}</td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="radio"
                          checked={contactPreferences[row.key as keyof typeof contactPreferences] === "yes"}
                          onChange={() =>
                            setContactPreferences((current) => ({
                              ...current,
                              [row.key]: "yes",
                            }))
                          }
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <input
                          type="radio"
                          checked={contactPreferences[row.key as keyof typeof contactPreferences] === "no"}
                          onChange={() =>
                            setContactPreferences((current) => ({
                              ...current,
                              [row.key]: "no",
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-[color:var(--border)] p-4">
            <p className="text-sm font-semibold">Emergency and GP details *</p>
            <p className="mt-1 text-xs text-[color:var(--muted)]">
              Please provide both an emergency contact and your GP practice information.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-4">
                <h4 className="text-sm font-semibold">Emergency contact details *</h4>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  We use this only if there is an urgent safeguarding concern.
                </p>

                <div className="mt-3 grid gap-3">
                  <div>
                    <label htmlFor="emergencyFirstName" className="mb-1 block text-xs font-medium">
                      First name *
                    </label>
                    <input
                      id="emergencyFirstName"
                      value={emergencyFirstName}
                      onChange={(event) => setEmergencyFirstName(event.target.value)}
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="emergencyLastName" className="mb-1 block text-xs font-medium">
                      Last name *
                    </label>
                    <input
                      id="emergencyLastName"
                      value={emergencyLastName}
                      onChange={(event) => setEmergencyLastName(event.target.value)}
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="emergencyRelationship" className="mb-1 block text-xs font-medium">
                      Relationship to you *
                    </label>
                    <input
                      id="emergencyRelationship"
                      value={emergencyRelationship}
                      onChange={(event) => setEmergencyRelationship(event.target.value)}
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="emergencyPhone" className="mb-1 block text-xs font-medium">
                      Contact phone number *
                    </label>
                    <input
                      id="emergencyPhone"
                      value={emergencyPhone}
                      onChange={(event) => setEmergencyPhone(event.target.value)}
                      className="w-full px-3 py-2"
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-4">
                <h4 className="text-sm font-semibold">GP details *</h4>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  Provide your registered GP practice and phone number.
                </p>

                <div className="mt-3 grid gap-3">
                  <div>
                    <label htmlFor="gpSurgeryName" className="mb-1 block text-xs font-medium">
                      GP surgery name *
                    </label>
                    <input
                      id="gpSurgeryName"
                      value={gpSurgeryName}
                      onChange={(event) => setGpSurgeryName(event.target.value)}
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="gpSurgeryPhone" className="mb-1 block text-xs font-medium">
                      GP surgery phone number *
                    </label>
                    <input
                      id="gpSurgeryPhone"
                      value={gpSurgeryPhone}
                      onChange={(event) => setGpSurgeryPhone(event.target.value)}
                      className="w-full px-3 py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="gpDoctorName" className="mb-1 block text-xs font-medium">
                      GP doctor name (optional)
                    </label>
                    <input
                      id="gpDoctorName"
                      value={gpDoctorName}
                      onChange={(event) => setGpDoctorName(event.target.value)}
                      className="w-full px-3 py-2"
                    />
                  </div>
                </div>
              </section>
            </div>
          </div>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-5">
          <div>
            <label htmlFor="mainIssue" className="mb-1 block text-sm font-medium">
              What do you consider your main presenting issue to be? *
            </label>
            <select
              id="mainIssue"
              value={mainIssue}
              onChange={(event) => setMainIssue(event.target.value as (typeof PRESENTING_ISSUE_OPTIONS)[number])}
              className="w-full px-3 py-2"
            >
              {PRESENTING_ISSUE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {toLabel(option)}
                </option>
              ))}
            </select>
          </div>

          {mainIssue === "OTHER" ? (
            <div>
              <label htmlFor="issueOtherDetail" className="mb-1 block text-sm font-medium">
                Please provide more details here: *
              </label>
              <textarea
                id="issueOtherDetail"
                rows={5}
                maxLength={1000}
                value={mainIssueOtherDetail}
                onChange={(event) => setMainIssueOtherDetail(event.target.value)}
                className="w-full px-3 py-2"
              />
              <p className="mt-1 text-right text-xs text-[color:var(--muted)]">
                {mainIssueOtherDetail.length}/1000
              </p>
            </div>
          ) : null}

          <div>
            <label htmlFor="issueDuration" className="mb-1 block text-sm font-medium">
              How long has your main presenting issue been affecting you? *
            </label>
            <input
              id="issueDuration"
              value={issueDuration}
              onChange={(event) => setIssueDuration(event.target.value)}
              className="w-full px-3 py-2"
            />
          </div>

          <div>
            <p className="text-sm font-medium">
              Have you had any previous support? e.g. counselling, GP, CPN, Psychiatrist, Minister/Pastor etc *
            </p>
            <div className="mt-2 flex gap-6 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={previousSupport === "yes"}
                  onChange={() => setPreviousSupport("yes")}
                />
                Yes
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={previousSupport === "no"}
                  onChange={() => setPreviousSupport("no")}
                />
                No
              </label>
            </div>
            {previousSupport === "yes" ? (
              <textarea
                rows={5}
                maxLength={1000}
                value={previousSupportDetails}
                onChange={(event) => setPreviousSupportDetails(event.target.value)}
                placeholder="If you have had previous support, please provide more detail here."
                className="mt-2 w-full px-3 py-2"
              />
            ) : null}
          </div>

          <div className="cg-sensitive-section space-y-5">
            <div>
              <p className="text-sm font-semibold text-[color:var(--cg-ink)]">Safeguarding Questions</p>
              <p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">
                These questions help us provide you with the most appropriate support. Your answers are
                treated with complete confidentiality.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium">Have you had any suicidal thoughts recently? *</p>
              <div className="mt-2 flex gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={suicidalThoughtsRecently === "yes"}
                    onChange={() => setSuicidalThoughtsRecently("yes")}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={suicidalThoughtsRecently === "no"}
                    onChange={() => setSuicidalThoughtsRecently("no")}
                  />
                  No
                </label>
              </div>
              {suicidalThoughtsRecently === "yes" ? (
                <>
                  <textarea
                    rows={5}
                    maxLength={1000}
                    value={suicidalThoughtsDetails}
                    onChange={(event) => setSuicidalThoughtsDetails(event.target.value)}
                    placeholder="If you have had suicidal thoughts recently, please provide more detail here."
                    className="mt-2 w-full px-3 py-2"
                  />
                  <div className="cg-alert cg-alert-info mt-2">
                    <p className="text-xs font-medium">If you are in crisis right now, please contact:</p>
                    <p className="mt-1 text-xs">Samaritans: <strong>116 123</strong> (24hr) | Lifeline NI: <strong>0808 808 8000</strong></p>
                  </div>
                </>
              ) : null}
            </div>

            <div>
              <p className="text-sm font-medium">Have you ever attempted suicide? *</p>
              <div className="mt-2 flex gap-6 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={attemptedSuicide === "yes"}
                    onChange={() => setAttemptedSuicide("yes")}
                  />
                  Yes
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={attemptedSuicide === "no"}
                    onChange={() => setAttemptedSuicide("no")}
                  />
                  No
                </label>
              </div>
              {attemptedSuicide === "yes" ? (
                <textarea
                  rows={5}
                  maxLength={1000}
                  value={attemptedSuicideDetails}
                  onChange={(event) => setAttemptedSuicideDetails(event.target.value)}
                  placeholder="If you have attempted suicide, please provide more detail here."
                  className="mt-2 w-full px-3 py-2"
                />
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-5">
          <div className="rounded-2xl border border-[color:var(--border)] p-4">
            <h3 className="text-xl">{content.availability.heading}</h3>
            <p className="mt-2 text-sm text-[color:var(--muted)]">{content.availability.subheading}</p>
            <p className="mt-2 text-xs text-[color:var(--muted)]">
              {assignmentMode === "manual"
                ? "Ops will assign your counsellor manually using your selected time-of-day preferences."
                : "Your selected availability will be matched against provider availability automatically."}
            </p>

            <div className="mt-4 border-t border-[color:var(--border)] pt-4">
              <p className="text-sm font-semibold">
                Please select one physical location. You can also opt into online sessions. *
              </p>
              <div className="mt-2 space-y-2">
                {LOCATION_OPTIONS.map((option) => (
                  <label key={option} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={location === option}
                      onChange={() => setLocation(option)}
                    />
                    {toLabel(option)}
                  </label>
                ))}
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeOnline}
                    onChange={(event) => setIncludeOnline(event.target.checked)}
                  />
                  Online (may not be suitable for couples)
                </label>
              </div>
            </div>

            <div className="mt-4 border-t border-[color:var(--border)] pt-4">
              <p className="text-sm font-semibold">Which times of day are you usually available? *</p>
              <div className="mt-2 flex flex-wrap gap-3">
                {TIME_PREFERENCE_OPTIONS.map((option) => (
                  <label
                    key={option}
                    className="flex items-center gap-2 rounded-full border border-[color:var(--border)] px-3 py-1.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={timePreferences.includes(option)}
                      onChange={() => toggleTimePreference(option)}
                    />
                    {toLabel(option)}
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {content.availability.notes.map((note) => (
                <div key={note.title}>
                  <p className="text-sm font-semibold text-[color:var(--cg-ink)]">{note.title}:</p>
                  <p className="text-sm text-[color:var(--muted)]">{note.body}</p>
                </div>
              ))}
              <p className="text-sm italic text-[color:var(--muted)]">{content.availability.disclaimer}</p>
              <p className="text-sm font-semibold">{content.availability.prompt}</p>
            </div>
          </div>

          {assignmentMode === "auto" ? (
            <div className="rounded-2xl border border-[color:var(--border)] p-4">
              <h4 className="text-base">Availability Widget</h4>
              <p className="mt-1 text-sm text-[color:var(--muted)]">
                Select one or more suitable windows from provider availability.
              </p>
              {availabilityLoading ? <p className="mt-3 text-sm">Loading availability...</p> : null}
              {availabilityError ? (
                <p className="mt-3 cg-alert cg-alert-warning">
                  {availabilityError}
                </p>
              ) : null}
              {!availabilityLoading && availabilitySlots.length > 0 ? (
                <div className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1">
                  {availabilitySlots.map((slot) => {
                    const key = `${slot.startTime}|${slot.endTime}`;
                    const checked = selectedSlotKeys.includes(key);
                    return (
                      <label
                        key={key}
                        className="flex items-start gap-2 rounded-xl border border-[color:var(--border)] p-2 text-sm"
                      >
                        <input type="checkbox" checked={checked} onChange={() => toggleSlot(slot)} />
                        <span>
                          <span className="block font-medium">{formatSlotLabel(slot.startTime, slot.endTime)}</span>
                          <span className="block text-xs text-[color:var(--muted)]">
                            Based on current provider availability
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/20 p-4">
              <h4 className="text-base">Manual allocation</h4>
              <p className="mt-1 text-sm text-[color:var(--muted)]">
                A member of our operations team will assign your counsellor and confirm a time based on
                your selected preferences.
              </p>
              </div>
          )}

          <div>
            <label htmlFor="availabilityNotes" className="mb-1 block text-sm font-medium">
              Please list your availability notes *
            </label>
            <textarea
              id="availabilityNotes"
              rows={5}
              maxLength={1000}
              placeholder="For example: Monday 9.30am-1.00pm, Tuesday 2.30pm-4.00pm and Friday any time from 2.00pm."
              value={availabilityNotes}
              onChange={(event) => setAvailabilityNotes(event.target.value)}
              className="w-full px-3 py-2"
            />
            <p className="mt-1 text-right text-xs text-[color:var(--muted)]">
              {availabilityNotes.length}/1000
            </p>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap justify-between gap-3 pt-1">
        <button
          type="button"
          onClick={previousStep}
          disabled={step === 0 || submitting}
          className="cg-cta-secondary px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
        >
          Back
        </button>
        {step < STEP_TITLES.length - 1 ? (
          <button type="button" onClick={nextStep} className="cg-cta-primary px-5 py-2 text-xs text-white">
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="cg-cta-primary px-5 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        )}
      </div>
    </div>
  );
}
