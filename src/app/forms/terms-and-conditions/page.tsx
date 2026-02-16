import Link from "next/link";
import { BrandWordmark } from "@/components/brand-wordmark";
import { TermsOfCounsellingForm } from "@/components/forms/terms-of-counselling-form";
import { requireFormAccessOrRedirect } from "@/lib/form-access";

type TermsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const TERMS_OF_COUNSELLING_LEGAL_COPY = `Welcome to Christian Guidelines. It is important that you should be aware of, and agree to, the terms under which we operate our Counselling Service.

As an organisation, all our Counsellors are required to adhere to a strict code of ethics as set out by the ACC (Association of Christian Counsellors & Linked Professions) and BACP (British Association for Counselling and Psychotherapy). The following terms are based on that ethical code, and we ask that you, as evidence of your understanding and acceptance of these terms, either digitally sign and submit the contracts prior to your first session or give them to your Counsellor at the commencement of counselling. We require that you also retain a copy of these terms.

It is our policy not to counsel clients who are currently engaged in counselling with another organisation or receiving psychological support elsewhere.

__________________________________________________________________

In order to make counselling accessible to all, we offer a donation based approach to those who are offered a counselling appointment.

This is based on a minimum donation of £10 per session.

We also recognise that everyone's circumstances are different so clients should feel free to give more if they wish.

Where someone is struggling to make a donation based on the minimum of £10, we encourage them to contact the office at admin@cguidelines.org.uk we will do all we can to ensure they receive the support they need.
__________________________________________________________________

APPOINTMENTS:

1.        Counselling appointments are normally for no more than one hour, so punctuality is particularly important.

FOR TELEPHONE/ONLINE SESSIONS:

If your session is being conducted online or by telephone, please be available to connect with your Counsellor at the agreed time. It is most important that you can speak from a place where you are safe and private, and unable to be overheard by others. The use of headphones or earpieces, if available, will ensure that the voice of the Counsellor will be heard by you only.

If your session is affected by technological issues which affect the ability to communicate, both the Counsellor and you should:

Log out of the software;
Wait a few minutes;
Attempt to log back in; (if this is successful, the session continues)
If this does not work, the Counsellor will contact you by telephone/email to arrange a new date for the session. (Please be aware that the Counsellor's telephone number may be withheld)
2.      Audio and video recording for sessions is prohibited without the clear knowledge and written consent of both the Counsellor and you.

3.      The effectiveness of the counselling process will be reviewed by your Counsellor and his or her supervisor after 6 sessions however this does not mean that counselling is limited to 6 sessions. With your knowledge and consent another member of the team may be introduced if it is thought to be in your best interest, or in the case of the illness of the Counsellor.

APPOINTMENT CANCELLATION POLICY:

4.      Should you wish to cancel an appointment please give as much notice as possible i.e., at least 24 hours by calling 028-91468846, or sending a text/WhatsApp message to 07715215737, or an email to admin@cguidelines.org.uk. This allows time to notify your Counsellor and allocate the room and time to another Counsellor and client.

OTHER COMMUNICATION:

5.      With your consent, your Counsellor may send online meeting invites, therapy enhancing resources such as links to articles and books.  Your counsellor will communicate via an email address assigned to them by Christian Guidelines i.e., ****@cguidelines.org.uk

6.      Administrative staff may also contact you for purposes such as arranging, cancelling, and changing appointments. Other basic information e.g., our location, links to general forms may also be communicated.

7.      As there may be risks associated with electronic methods of communication you should not use these methods to contact the office or your Counsellor with content that would be considered sensitive. Such content will not be responded to and may be discussed for clarification in your next session with your Counsellor.  Further detail on our Electronic Communications Policy is available upon request.

TERMINATION OF COUNSELLING POLICY:

8.      If you wish to terminate counselling at any time you have a right to do so, but we would appreciate it if you would give us as much notice as possible.

9.      Christian Guidelines may terminate counselling if, after discussion with you, it was felt that it would not be beneficial or appropriate to continue. Sometimes, we recommend another agency which may be able to help.

10.  Christian Guidelines receive many requests for our counselling services and must make the most effective use of Counsellor's time. Therefore, repeated failure to attend scheduled sessions will result in the termination of the counselling process. Three missed appointments, without adequate notice, will lead to Christian Guidelines bringing the counselling process to an end. (Point 4 refers.)

RESPONSIBILITY/LIABILITY:

11.  Please be aware that Christian Guidelines Counselling Service cannot accept responsibility for your response to counselling, and that any advice or assistance given while in counselling does not create any legal liability on the part of Christian Guidelines. Choices and changes are made by you i.e., you decide whether to act upon your choices.

12.  Your Counsellor may suggest certain tasks for you to work on between sessions. These should be seen as an important part of the counselling process and are intended to reinforce the effectiveness of it.

CONFIDENTIALITY:

13.  Confidentiality is treated very seriously but cannot be guaranteed under every circumstance. If the Counsellor forms a reasonable belief that you:

·      may present a serious risk to yourself or to some other person.

·      have disclosed evidence of a serious criminal offence.

·      have disclosed information of risk involving a minor or an adult in need of care and protection.

In these circumstances we have both a duty of care and certain legal obligations. In a situation where life may be at risk, Christian Guidelines reserves the right to act in whatever way it deems most appropriate e.g., contact your emergency contact, GP, or emergency services.

RECORD-KEEPING & GDPR:

14.  Your Counsellor is required by Christian Guidelines to retain any factual summary notes made of your counselling process for a period of three years following your final session.  After which all notes will be securely destroyed (unless in the very exceptional circumstance that they have been subpoenaed by a court of law as part of an ongoing legal process). Your Counsellor may need to record some 'Special Category Information' which may be considered of a sensitive nature. This is in accordance with directions from the Association of Christian Counsellors and is permitted under Article 9 (2)(f) General Data Protection Regulations (GDPR). The General Data Protection Regulations list Special Category Information as anything relating to race; ethnic origin; politics; religion; trade union membership; genetics; biometrics (where used for ID purposes); health; sex life; or sexual orientation. As a client of Christian Guidelines, it is anticipated that one or more of these topics will be discussed with your Counsellor.  It is necessary for you to give explicit consent for your Counsellor to gather and record this type of information. You may withdraw your consent at any time and no further information of this type will be gathered. This will not affect the information already gathered by your Counsellor as this will have been done lawfully.

15.  You are entitled to see any notes relating to you that the Counsellor might make, and you have the right to make changes to those notes to ensure they are up to date and accurate.

16.  You will not be personally identifiable from the summary notes. Your identifiable information will not be shared with any third party unless it is considered essential by your Counsellor to do so to protect you or some other person in need of care and protection from serious harm; or there is disclosure of evidence of a serious criminal offence. Such information will not be shared without your knowledge. Only in very exceptional circumstances may they be accessed by another party i.e., if subpoenaed by a court of law, or following the death of the counsellor whereby a professional individual/body, designated by your counsellor would securely hold the notes.

PRIVACY POLICY:

17.  Christian Guidelines' privacy policy may be accessed at this link: https://www.christianguidelines.org/privacy-policy ,or a paper version is available upon request.

CONCERNS OR COMPLAINTS:

18.  If you have concerns regarding any aspect of the Counselling Service, please raise it with your Counsellor. Details of our Complaints Procedure are available on request.

19.  It is not the policy of our organisation to become involved in any litigation issues.

CLIENT DECLARATION:

I agree to the terms set out in this document and will co-operate, to the best of my ability, with my Counsellor.

I give explicit consent for my Counsellor to gather and record such Special Category Information as might be considered essential to this process of counselling.

[ box where a client signs using signature. ]

[box where client types their name.]

[date]

CHRISTIAN GUIDELINES LTD CONTACT DETAILS:

2nd Floor The Link, 10 West St, Newtownards. BT23 4EN.

Tel: 028 9146 8846 Email: admin@cguidelines.org.uk www.christianguidelines.org

NI Charities Commission No. 103255 HMRC Charity XR2927 Company No. NI041272`;

export default async function TermsAndConditionsPage({ searchParams }: TermsPageProps) {
  const query = await searchParams;
  const accessKey = typeof query.accessKey === "string" ? query.accessKey : "";

  if (!accessKey) {
    return (
      <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
        <div className="mx-auto max-w-[520px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
          <BrandWordmark className="mx-auto h-14 w-auto" />
          <h1 className="mt-6 text-2xl font-bold text-[color:var(--cg-ink)]">
            Access key required
          </h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            This secure form can only be opened from your emailed access link.
          </p>
          <p className="mt-4 text-xs">
            <Link href="/intake" className="underline">
              Back to intake
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const nextPath = `/forms/terms-and-conditions?accessKey=${encodeURIComponent(accessKey)}`;
  const session = await requireFormAccessOrRedirect({
    accessKey,
    formType: "TERMS_AND_CONDITIONS",
    nextPath,
  });

  return (
    <main className="min-h-screen bg-[color:var(--cg-light-accent)] px-[var(--cg-gutter-mobile)] py-20 md:px-[var(--cg-gutter)]">
      <div className="mx-auto max-w-[720px] rounded-2xl bg-[color:var(--cg-white)] p-8 shadow-sm">
        <BrandWordmark className="mx-auto h-14 w-auto" />
        <h1 className="mt-6 text-3xl font-bold text-[color:var(--cg-ink)]">
          Terms of Counselling
        </h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Case: <strong>{session.caseReference}</strong>
        </p>
        <p className="text-sm text-[color:var(--muted)]">
          Participant: <strong>{session.participantName}</strong> ({session.participantEmail})
        </p>

        <p className="mt-4 text-sm text-[color:var(--muted)]">
          Please read this carefully before signing and submitting your declaration.
        </p>

        <section className="mt-6 rounded-xl border border-[color:var(--border)] bg-[#efeff8] p-4 text-sm leading-6">
          <article className="rounded-xl bg-white p-5">
            <h2 className="text-lg">Christian Guidelines - Terms of Counselling</h2>
            <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6">
              {TERMS_OF_COUNSELLING_LEGAL_COPY}
            </pre>
          </article>
        </section>

        <div className="mt-6">
          <TermsOfCounsellingForm
            caseId={session.caseId}
            participantIdentifier={session.participantEmail}
            accessKey={accessKey}
            successMessage="Thank you. Your terms response has been recorded."
          />
        </div>
      </div>
    </main>
  );
}
