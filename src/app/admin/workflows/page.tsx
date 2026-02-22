import { UserRole, WorkflowStepCode, WorkflowStepType } from "@prisma/client";
import {
  addWorkflowStepAction,
  createWorkflowPresetAction,
  createWorkflowTemplateAction,
  updateWorkflowStepAction,
} from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { listWorkflowTemplatesForOps } from "@/lib/case-service";

type AdminWorkflowsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type WorkflowPresetOption = {
  preset: "INDIVIDUAL" | "COUPLES";
  title: string;
  summary: string;
  defaultCode: string;
  defaultName: string;
  defaultDescription: string;
  highlights: string[];
  buttonLabel: string;
};

const WORKFLOW_PRESETS: WorkflowPresetOption[] = [
  {
    preset: "INDIVIDUAL",
    title: "Individual Counselling (Recommended)",
    summary: "Good default for one-to-one counselling with a simple scheduling gate.",
    defaultCode: "INDIVIDUAL_COUNSELLING",
    defaultName: "Individual Counselling",
    defaultDescription: "Recommended baseline workflow for one-to-one counselling.",
    highlights: [
      "Intake form must be complete before scheduling.",
      "Availability capture must be complete before scheduling.",
      "Terms & conditions stays as a post-booking requirement.",
    ],
    buttonLabel: "Create Individual Preset",
  },
  {
    preset: "COUPLES",
    title: "Couples Counselling (Recommended)",
    summary: "Tracks both participants and blocks scheduling until shared requirements are met.",
    defaultCode: "COUPLES_COUNSELLING",
    defaultName: "Couples Counselling",
    defaultDescription: "Recommended workflow where both participants complete required form steps.",
    highlights: [
      "Intake/consent/agreement require both participants.",
      "Availability capture requires both participants.",
      "Terms & conditions stays as a post-booking requirement.",
    ],
    buttonLabel: "Create Couples Preset",
  },
];

const WORKFLOW_STEP_CODE_OPTIONS: WorkflowStepCode[] = [
  WorkflowStepCode.INTAKE_FORM,
  WorkflowStepCode.AVAILABILITY_CAPTURED,
  WorkflowStepCode.TERMS_AND_CONDITIONS,
  WorkflowStepCode.CONSENT_FORM,
  WorkflowStepCode.AGREEMENT_FORM,
  WorkflowStepCode.OUTTAKE_FORM,
  WorkflowStepCode.CUSTOM,
];

const WORKFLOW_STEP_CODE_LABELS: Record<WorkflowStepCode, string> = {
  [WorkflowStepCode.INTAKE_FORM]: "Intake form completion",
  [WorkflowStepCode.AVAILABILITY_CAPTURED]: "Availability captured",
  [WorkflowStepCode.TERMS_AND_CONDITIONS]: "Terms and conditions completion",
  [WorkflowStepCode.CONSENT_FORM]: "Consent form completion",
  [WorkflowStepCode.AGREEMENT_FORM]: "Agreement form completion",
  [WorkflowStepCode.OUTTAKE_FORM]: "Outtake form completion",
  [WorkflowStepCode.CUSTOM]: "Custom",
};

function stepTypeHint(type: WorkflowStepType) {
  if (type === WorkflowStepType.FORM) {
    return "Completes when the mapped form is submitted.";
  }

  if (type === WorkflowStepType.REVIEW) {
    return "Completes when staff manually review or approve.";
  }

  return "Completes automatically from system events.";
}

function stepTypeBadgeClass(type: WorkflowStepType) {
  if (type === WorkflowStepType.FORM) {
    return "border-[color:var(--cg-status-matched-border)] bg-[color:var(--cg-status-matched-bg)] text-[color:var(--cg-status-matched)]";
  }

  if (type === WorkflowStepType.REVIEW) {
    return "border-[color:var(--cg-status-review-border)] bg-[color:var(--cg-status-review-bg)] text-[color:var(--cg-status-review)]";
  }

  return "border-[color:var(--border)] bg-slate-50 text-[color:var(--muted)]";
}

function stepCodeLabel(stepCode: WorkflowStepCode | null) {
  if (!stepCode) {
    return "Unspecified";
  }

  return WORKFLOW_STEP_CODE_LABELS[stepCode] || stepCode;
}

export default async function AdminWorkflowsPage({ searchParams }: AdminWorkflowsPageProps) {
  const user = await requirePageUser([UserRole.OPS]);
  const [workflows, query] = await Promise.all([listWorkflowTemplatesForOps(), searchParams]);
  const error = typeof query.error === "string" ? query.error : null;

  return (
    <AuthenticatedShell
      title="Workflow Configuration"
      subtitle="Set the templates that control scheduling eligibility. Daily assignment still happens in Assignments."
      userName={user.name}
      role={user.role}
      currentPath="/admin/workflows"
      navItems={[
        { href: "/admin/cases", label: "All Cases" },
        { href: "/admin/assignments", label: "Assignments" },
        { href: "/admin/clients", label: "All Clients" },
        { href: "/admin/specialists", label: "Counsellors" },
        { href: "/admin/workflows", label: "Workflows" },
        { href: "/admin/settings", label: "Settings" },
        { href: "/intake", label: "Secure Intake" },
      ]}
    >
      {error ? (
        <p className="mb-4 cg-alert cg-alert-error">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="cg-nav-label text-[color:var(--muted)]">Setup Shortcuts</p>
            <h2 className="mt-1 text-lg font-semibold">Start from a recommended template</h2>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              Most teams should create one individual and one couples template from these presets,
              then only tweak names and checkboxes.
            </p>
          </div>
          <div className="max-w-sm rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/45 px-3 py-2 text-xs text-[color:var(--muted)]">
            <p className="font-semibold text-[color:var(--foreground)]">Daily ops note</p>
            <p className="mt-1">
              Use this page for configuration. Day-to-day case movement and reassignment happen in
              <span className="font-semibold"> Assignment Dashboard</span>.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {WORKFLOW_PRESETS.map((preset) => (
            <form
              key={preset.preset}
              action={createWorkflowPresetAction}
              className="rounded-xl border border-[color:var(--border)] bg-white p-4"
            >
              <input type="hidden" name="preset" value={preset.preset} />
              <input type="hidden" name="redirectTo" value="/admin/workflows" />

              <h3 className="text-sm font-semibold text-[color:var(--cg-ink)]">{preset.title}</h3>
              <p className="mt-1 text-xs text-[color:var(--muted)]">{preset.summary}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-[color:var(--muted)]">
                {preset.highlights.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                <label className="text-xs md:col-span-2">
                  Template code
                  <input
                    name="code"
                    defaultValue={preset.defaultCode}
                    className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1.5 text-sm"
                  />
                </label>

                <label className="text-xs md:col-span-2">
                  Template name
                  <input
                    name="name"
                    defaultValue={preset.defaultName}
                    className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1.5 text-sm"
                  />
                </label>

                <label className="text-xs md:col-span-2">
                  Description
                  <input
                    name="description"
                    defaultValue={preset.defaultDescription}
                    className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1.5 text-sm"
                  />
                </label>

                <label className="inline-flex items-center gap-2 text-xs md:col-span-2">
                  <input type="checkbox" name="isDefault" />
                  Set as default workflow
                </label>

                <button
                  type="submit"
                  className="cg-cta-primary w-fit px-3 py-1.5 text-xs text-white md:col-span-2"
                >
                  {preset.buttonLabel}
                </button>
              </div>
            </form>
          ))}
        </div>

        <details className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/25 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-[color:var(--accent)]">
            Create custom workflow (advanced)
          </summary>
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            Use this only if the recommended templates do not fit your process.
          </p>
          <form
            action={createWorkflowTemplateAction}
            className="mt-3 grid gap-3 rounded-xl border border-[color:var(--border)] bg-white p-4 md:grid-cols-2"
          >
            <input type="hidden" name="redirectTo" value="/admin/workflows" />

            <label className="text-sm">
              Template code
              <input
                name="code"
                required
                placeholder="GENERAL_COUNSELLING"
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
              />
            </label>

            <label className="text-sm">
              Template name
              <input
                name="name"
                required
                placeholder="General Counselling"
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
              />
            </label>

            <label className="text-sm">
              Counselling type key
              <input
                name="counsellingType"
                required
                placeholder="individual | couples | grief | youth"
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
              />
            </label>

            <label className="text-sm">
              Description
              <input
                name="description"
                placeholder="Optional"
                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
              />
            </label>

            <label className="inline-flex items-center gap-2 text-sm md:col-span-2">
              <input type="checkbox" name="isDefault" />
              Set as default workflow
            </label>

            <button
              type="submit"
              className="cg-cta-primary w-fit px-4 py-2 text-xs text-white md:col-span-2"
            >
              Create custom workflow
            </button>
          </form>
        </details>
      </section>

      <section className="mt-4 grid gap-4">
        {workflows.length === 0 ? (
          <div className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] shadow-sm">
            <div className="cg-empty-state py-12">
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="cg-empty-state-icon">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
              </svg>
              <p className="text-sm font-medium">No workflow templates yet</p>
              <p className="mt-1 text-xs">Create from a recommended preset above.</p>
            </div>
          </div>
        ) : null}
        {workflows.map((workflow) => {
          const orderedSteps = [...workflow.steps].sort((a, b) => a.sortOrder - b.sortOrder);
          const blockingCount = orderedSteps.filter((step) => step.blocksScheduling).length;
          const requiredCount = orderedSteps.filter((step) => step.required).length;
          const allParticipantCount = orderedSteps.filter((step) => step.requiresAllParticipants).length;

          return (
            <article
              key={workflow.id}
              className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold">{workflow.name}</h3>
                  <p className="text-xs text-[color:var(--muted)]">
                    {workflow.code} • type: {workflow.counsellingType}
                    {workflow.isDefault ? " • default" : ""}
                  </p>
                </div>
                <span className="text-xs text-[color:var(--muted)]">
                  {workflow.active ? "Active" : "Inactive"}
                </span>
              </div>

              {workflow.description ? (
                <p className="mt-2 text-sm text-[color:var(--muted)]">{workflow.description}</p>
              ) : null}

              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <div className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2">
                  <p className="cg-nav-label text-[color:var(--muted)]">Total steps</p>
                  <p className="mt-1 text-lg font-semibold">{orderedSteps.length}</p>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2">
                  <p className="cg-nav-label text-[color:var(--muted)]">Must complete</p>
                  <p className="mt-1 text-lg font-semibold">{requiredCount}</p>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2">
                  <p className="cg-nav-label text-[color:var(--muted)]">Blocks scheduling</p>
                  <p className="mt-1 text-lg font-semibold">{blockingCount}</p>
                </div>
                <div className="rounded-xl border border-[color:var(--border)] bg-white px-3 py-2">
                  <p className="cg-nav-label text-[color:var(--muted)]">Both participants</p>
                  <p className="mt-1 text-lg font-semibold">{allParticipantCount}</p>
                </div>
              </div>

              <div className="mt-4">
                <p className="cg-nav-label text-[color:var(--muted)]">Flow Preview</p>
                <p className="mt-1 text-sm text-[color:var(--muted)]">
                  Keep this simple. Only steps marked &quot;Blocks scheduling&quot; prevent
                  assignment.
                </p>

                {orderedSteps.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-[color:var(--border)] bg-white p-4 text-sm text-[color:var(--muted)]">
                    No steps configured yet.
                  </div>
                ) : (
                  <ol className="mt-3 grid gap-3 lg:grid-cols-2">
                    {orderedSteps.map((step, index) => (
                      <li
                        key={step.id}
                        className="rounded-xl border border-[color:var(--border)] bg-white p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="cg-nav-label text-[color:var(--muted)]">Step {index + 1}</p>
                          <span className="rounded-full border border-[color:var(--border)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--muted)]">
                            Position {step.sortOrder}
                          </span>
                        </div>

                        <h4 className="mt-1 text-base font-semibold">{step.name}</h4>
                        <p className="mt-1 text-xs text-[color:var(--muted)]">
                          {stepTypeHint(step.type)}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${stepTypeBadgeClass(step.type)}`}
                          >
                            {step.type}
                          </span>
                          <span className="rounded-full border border-[color:var(--border)] bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            Must complete: {step.required ? "Yes" : "No"}
                          </span>
                          <span className="rounded-full border border-[color:var(--border)] bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            Blocks scheduling: {step.blocksScheduling ? "Yes" : "No"}
                          </span>
                          <span className="rounded-full border border-[color:var(--border)] bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            Participant scope: {step.requiresAllParticipants ? "Both" : "Any one"}
                          </span>
                        </div>

                        <details className="mt-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--accent-soft)]/25 p-2">
                          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-[color:var(--accent)]">
                            Edit step
                          </summary>
                          <form action={updateWorkflowStepAction} className="mt-2 grid gap-2 md:grid-cols-2">
                            <input type="hidden" name="workflowStepId" value={step.id} />
                            <input type="hidden" name="caseWorkflowTemplateId" value={workflow.id} />
                            <input type="hidden" name="redirectTo" value="/admin/workflows" />

                            <label className="text-xs md:col-span-2">
                              Step name
                              <input
                                name="name"
                                defaultValue={step.name}
                                required
                                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                              />
                            </label>

                            <label className="inline-flex items-center gap-2 text-xs">
                              <input type="checkbox" name="required" defaultChecked={step.required} />
                              Must be completed
                            </label>

                            <label className="inline-flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                name="blocksScheduling"
                                defaultChecked={step.blocksScheduling}
                              />
                              Block scheduling until complete
                            </label>

                            <label className="inline-flex items-center gap-2 text-xs md:col-span-2">
                              <input
                                type="checkbox"
                                name="requiresAllParticipants"
                                defaultChecked={step.requiresAllParticipants}
                              />
                              Require both participants for this step
                            </label>

                            <details className="rounded-md border border-[color:var(--border)] bg-white p-2 md:col-span-2">
                              <summary className="cursor-pointer text-xs font-semibold text-[color:var(--muted)]">
                                Advanced fields (optional)
                              </summary>
                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                <label className="text-xs">
                                  Step type
                                  <select
                                    name="type"
                                    defaultValue={step.type}
                                    className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                                  >
                                    <option value="FORM">FORM</option>
                                    <option value="REVIEW">REVIEW</option>
                                    <option value="SYSTEM">SYSTEM</option>
                                  </select>
                                </label>

                                <label className="text-xs">
                                  Step code
                                  <select
                                    name="stepCode"
                                    defaultValue={step.stepCode ?? ""}
                                    className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                                  >
                                    <option value="">Unspecified</option>
                                    {WORKFLOW_STEP_CODE_OPTIONS.map((stepCodeOption) => (
                                      <option key={stepCodeOption} value={stepCodeOption}>
                                        {stepCodeOption} - {WORKFLOW_STEP_CODE_LABELS[stepCodeOption]}
                                      </option>
                                    ))}
                                  </select>
                                </label>

                                <label className="text-xs md:col-span-2">
                                  Form type key (only used for FORM steps)
                                  <input
                                    name="formType"
                                    defaultValue={step.formType ?? ""}
                                    className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                                  />
                                </label>

                                <label className="text-xs">
                                  Position order
                                  <input
                                    name="sortOrder"
                                    type="number"
                                    defaultValue={step.sortOrder}
                                    className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                                  />
                                </label>
                              </div>
                            </details>

                            <div className="md:col-span-2">
                              <p className="text-[11px] text-[color:var(--muted)]">
                                Technical mapping: {stepCodeLabel(step.stepCode)}
                                {step.formType ? ` • form key ${step.formType}` : ""}
                              </p>
                            </div>

                            <button
                              type="submit"
                              className="w-fit rounded-md border border-[color:var(--border)] px-3 py-1.5 text-xs font-semibold hover:bg-[color:var(--accent-soft)] md:col-span-2"
                            >
                              Save step
                            </button>
                          </form>
                        </details>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <details className="mt-4 rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/25 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[color:var(--accent)]">
                  Add step to this workflow
                </summary>
                <form
                  action={addWorkflowStepAction}
                  className="mt-3 grid gap-3 rounded-lg border border-[color:var(--border)] bg-white p-3 md:grid-cols-2"
                >
                  <input type="hidden" name="caseWorkflowTemplateId" value={workflow.id} />
                  <input type="hidden" name="redirectTo" value="/admin/workflows" />

                  <label className="text-xs md:col-span-2">
                    Step name
                    <input
                      name="name"
                      required
                      className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" name="required" defaultChecked />
                    Must be completed
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" name="blocksScheduling" />
                    Block scheduling until complete
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs md:col-span-2">
                    <input type="checkbox" name="requiresAllParticipants" />
                    Require both participants for this step
                  </label>

                  <details className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-2 md:col-span-2">
                    <summary className="cursor-pointer text-xs font-semibold text-[color:var(--muted)]">
                      Advanced fields (optional)
                    </summary>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <label className="text-xs">
                        Step type
                        <select
                          name="type"
                          defaultValue="FORM"
                          className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                        >
                          <option value="FORM">FORM</option>
                          <option value="REVIEW">REVIEW</option>
                          <option value="SYSTEM">SYSTEM</option>
                        </select>
                      </label>

                      <label className="text-xs">
                        Step code
                        <select
                          name="stepCode"
                          defaultValue="CUSTOM"
                          className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                        >
                          {WORKFLOW_STEP_CODE_OPTIONS.map((stepCodeOption) => (
                            <option key={stepCodeOption} value={stepCodeOption}>
                              {stepCodeOption} - {WORKFLOW_STEP_CODE_LABELS[stepCodeOption]}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs md:col-span-2">
                        Form type key (for FORM steps)
                        <input
                          name="formType"
                          placeholder="TERMS_AND_CONDITIONS"
                          className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                        />
                      </label>

                      <label className="text-xs">
                        Position order
                        <input
                          name="sortOrder"
                          type="number"
                          defaultValue={orderedSteps.length * 10 + 10}
                          className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </details>

                  <button
                    type="submit"
                    className="w-fit rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)] md:col-span-2"
                  >
                    Add step
                  </button>
                </form>
              </details>
            </article>
          );
        })}
      </section>
    </AuthenticatedShell>
  );
}
