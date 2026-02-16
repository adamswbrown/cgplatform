import { UserRole } from "@prisma/client";
import { addWorkflowStepAction, createWorkflowTemplateAction } from "@/app/actions";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { requirePageUser } from "@/lib/auth";
import { listWorkflowTemplatesForOps } from "@/lib/case-service";

type AdminWorkflowsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

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
        { href: "/admin/clients", label: "All Clients" },
        { href: "/admin/specialists", label: "Specialists" },
        { href: "/admin/workflows", label: "Workflows" },
        { href: "/admin/settings/intake", label: "Intake Settings" },
        { href: "/intake", label: "Secure Intake" },
      ]}
    >
      {error ? (
        <p className="mb-4 rounded-md border border-[color:var(--danger)] bg-red-50 px-3 py-2 text-sm text-[color:var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-sm">
        <h2 className="text-lg font-semibold">Create Workflow Template</h2>
        <form action={createWorkflowTemplateAction} className="mt-3 grid gap-3 md:grid-cols-2">
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
              placeholder="general | couples | grief | youth"
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
            className="w-fit rounded-md bg-[color:var(--accent)] px-4 py-2 text-xs font-semibold text-white md:col-span-2"
          >
            Create workflow
          </button>
        </form>
      </section>

      <section className="mt-4 grid gap-4">
        {workflows.map((workflow) => (
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

            <div className="mt-3 overflow-x-auto rounded-xl border border-[color:var(--border)]">
              <table className="min-w-full divide-y divide-[color:var(--border)] text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Order</th>
                    <th className="px-3 py-2 font-semibold">Step</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">Form Type</th>
                    <th className="px-3 py-2 font-semibold">Required</th>
                    <th className="px-3 py-2 font-semibold">Blocks Scheduling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border)]">
                  {workflow.steps.map((step) => (
                    <tr key={step.id}>
                      <td className="px-3 py-2">{step.sortOrder}</td>
                      <td className="px-3 py-2">{step.name}</td>
                      <td className="px-3 py-2">{step.type}</td>
                      <td className="px-3 py-2">{step.formType || "-"}</td>
                      <td className="px-3 py-2">{step.required ? "Yes" : "No"}</td>
                      <td className="px-3 py-2">{step.blocksScheduling ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                  {workflow.steps.length === 0 ? (
                    <tr>
                      <td className="px-3 py-3 text-[color:var(--muted)]" colSpan={6}>
                        No steps configured.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <form
              action={addWorkflowStepAction}
              className="mt-3 grid gap-3 rounded-xl border border-[color:var(--border)] p-3 md:grid-cols-3"
            >
              <input type="hidden" name="caseWorkflowTemplateId" value={workflow.id} />
              <input type="hidden" name="redirectTo" value="/admin/workflows" />

              <label className="text-xs">
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
                  defaultValue={workflow.steps.length * 10 + 10}
                  className="mt-1 w-full rounded-md border border-[color:var(--border)] px-2 py-2 text-sm"
                />
              </label>

              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" name="required" defaultChecked />
                Required
              </label>

              <label className="inline-flex items-center gap-2 text-xs">
                <input type="checkbox" name="blocksScheduling" />
                Blocks scheduling
              </label>

              <button
                type="submit"
                className="w-fit rounded-md border border-[color:var(--border)] px-3 py-2 text-xs font-semibold hover:bg-[color:var(--accent-soft)] md:col-span-3"
              >
                Add step
              </button>
            </form>
          </article>
        ))}
      </section>
    </AuthenticatedShell>
  );
}
