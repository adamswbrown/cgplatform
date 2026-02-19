import { UserRole, WorkflowStepCode, WorkflowStepType } from "@prisma/client";
import {
  addWorkflowStepAction,
  createWorkflowTemplateAction,
  updateWorkflowStepAction,
} from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { listWorkflowTemplatesForOps } from "@/lib/case-service";

type AdminWorkflowsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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
  [WorkflowStepCode.AVAILABILITY_CAPTURED]: "Availability captured (from intake/API)",
  [WorkflowStepCode.TERMS_AND_CONDITIONS]: "Terms and conditions completion",
  [WorkflowStepCode.CONSENT_FORM]: "Consent form completion",
  [WorkflowStepCode.AGREEMENT_FORM]: "Agreement form completion",
  [WorkflowStepCode.OUTTAKE_FORM]: "Outtake form completion",
  [WorkflowStepCode.CUSTOM]: "Custom",
};

function stepTypeHint(type: WorkflowStepType) {
  if (type === WorkflowStepType.FORM) {
    return "Client or staff form completion";
  }

  if (type === WorkflowStepType.REVIEW) {
    return "Manual review or approval checkpoint";
  }

  return "Internal system-driven checkpoint";
}

function stepTypeBadgeClass(type: WorkflowStepType) {
  if (type === WorkflowStepType.FORM) {
    return "border-emerald-200 bg-emerald-50 text-emerald-900";
  }

  if (type === WorkflowStepType.REVIEW) {
    return "border-amber-200 bg-amber-50 text-amber-900";
  }

  return "border-slate-200 bg-slate-100 text-slate-800";
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
      title="Workflow Templates"
      subtitle="Design counselling workflows and assign form/review/system steps that control scheduling eligibility."
      userName={user.name}
      role={user.role}
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
        <p className="mb-4 rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="cg-nav-label text-[color:var(--muted)]">Workflow Designer</p>
            <h2 className="mt-1 text-lg font-semibold">Create Workflow Template</h2>
            <p className="mt-1 text-sm text-[color:var(--muted)]">
              Build the case lifecycle in ordered steps. Cases can only be scheduled after all
              blocking steps are completed.
            </p>
          </div>
          <div className="max-w-xs rounded-xl border border-[color:var(--border)] bg-[color:var(--accent-soft)]/45 px-3 py-2 text-xs text-[color:var(--muted)]">
            <p className="font-semibold text-[color:var(--foreground)]">Scheduling gate rule</p>
            <p className="mt-1">
              Steps marked <span className="font-mono">Blocks scheduling = Yes</span> must be
              completed before assignment.
            </p>
          </div>
        </div>

        <form
          action={createWorkflowTemplateAction}
          className="mt-4 grid gap-3 rounded-xl border border-[color:var(--border)] p-4 md:grid-cols-2"
        >
          <input type="hidden" name="redirectTo" value="/admin/workflows" />

          <label className="text-sm">
            Code
            <input
              name="code"
              required
              placeholder="GENERAL_COUNSELLING"
              className="mt-1 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm">
            Name
            <input
              name="name"
              required
              placeholder="General Counselling"
              className="mt-1 w-full rounded-md border border-[color:var(--border)] px-3 py-2 text-sm"
            />
          </label>

          <label className="text-sm">
            Counselling type
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

          <button type="submit" className="cg-cta-primary w-fit px-4 py-2 text-xs text-white md:col-span-2">
            Create workflow
          </button>
        </form>
      </section>

      <section className="mt-4 grid gap-4">
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
                  <p className="cg-nav-label text-[color:var(--muted)]">Required</p>
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
                  Cases move through these steps in order. Blocking steps must complete before
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
                            Order {step.sortOrder}
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
                            Code: {stepCodeLabel(step.stepCode)}
                          </span>
                          <span className="rounded-full border border-[color:var(--border)] bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            Required: {step.required ? "Yes" : "No"}
                          </span>
                          <span className="rounded-full border border-[color:var(--border)] bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                            Blocks scheduling: {step.blocksScheduling ? "Yes" : "No"}
                          </span>
                          {step.formType ? (
                            <span className="rounded-full border border-[color:var(--border)] bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                              Form: {step.formType}
                            </span>
                          ) : null}
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

                            <label className="text-xs">
                              Type
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
                                    {stepCodeOption}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label className="text-xs">
                              Sort order
                              <input
                                name="sortOrder"
                                type="number"
                                defaultValue={step.sortOrder}
                                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                              />
                            </label>

                            <label className="text-xs md:col-span-2">
                              Form type (optional)
                              <input
                                name="formType"
                                defaultValue={step.formType ?? ""}
                                className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-1 text-sm"
                              />
                            </label>

                            <label className="inline-flex items-center gap-2 text-xs">
                              <input type="checkbox" name="required" defaultChecked={step.required} />
                              Required
                            </label>

                            <label className="inline-flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                name="requiresAllParticipants"
                                defaultChecked={step.requiresAllParticipants}
                              />
                              Require both participants
                            </label>

                            <label className="inline-flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                name="blocksScheduling"
                                defaultChecked={step.blocksScheduling}
                              />
                              Blocks scheduling
                            </label>

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
                  className="mt-3 grid gap-3 rounded-lg border border-[color:var(--border)] bg-white p-3 md:grid-cols-2 xl:grid-cols-3"
                >
                  <input type="hidden" name="caseWorkflowTemplateId" value={workflow.id} />
                  <input type="hidden" name="redirectTo" value="/admin/workflows" />

                  <label className="text-xs xl:col-span-2">
                    Step name
                    <input
                      name="name"
                      required
                      className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                    />
                  </label>

                  <label className="text-xs">
                    Type
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
                          {stepCodeOption}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="text-xs xl:col-span-2">
                    Form type (optional)
                    <input
                      name="formType"
                      placeholder="TERMS_AND_CONDITIONS"
                      className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                    />
                  </label>

                  <label className="text-xs">
                    Sort order
                    <input
                      name="sortOrder"
                      type="number"
                      defaultValue={orderedSteps.length * 10 + 10}
                      className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                    />
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" name="required" defaultChecked />
                    Required
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" name="requiresAllParticipants" />
                    Require both participants
                  </label>

                  <label className="inline-flex items-center gap-2 text-xs">
                    <input type="checkbox" name="blocksScheduling" />
                    Blocks scheduling
                  </label>

                  <button
                    type="submit"
                    className="w-fit rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)] xl:col-span-3"
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
