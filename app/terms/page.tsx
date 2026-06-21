import type { Metadata } from "next"

import { LegalLink, LegalList, LegalSection, LegalShell } from "@/components/legal/legal-shell"

const CONTACT_EMAIL = "davidxizhenliu@gmail.com"
const LAST_UPDATED = "June 21, 2026"
const GOVERNING_LAW = "the State of Illinois, USA"

export const metadata: Metadata = {
  title: "Terms of Service — Jarvis",
  description: "The terms that govern your use of Jarvis.",
}

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms of Service"
      lastUpdated={LAST_UPDATED}
      intro={
        <p>
          These terms govern your use of Jarvis, a personal assistant operated by David (Xizhen) Liu
          as a sole proprietor (&ldquo;Jarvis,&rdquo; &ldquo;we,&rdquo; &ldquo;us&rdquo;). By using
          Jarvis, you agree to them. If you do not agree, please don&rsquo;t use the service.
        </p>
      }
    >
      <LegalSection heading="What Jarvis is">
        <p>
          Jarvis connects to tools you already use and helps you plan and stay on top of your work. It
          is currently in active, early-stage development and is offered on an as-available basis;
          features may change, break, or be removed as it improves.
        </p>
      </LegalSection>

      <LegalSection heading="Eligibility">
        <p>
          You must be at least 13 years old to use Jarvis. If you are under the age of majority where
          you live, use Jarvis only with the involvement of a parent, guardian, or your school.
        </p>
      </LegalSection>

      <LegalSection heading="Your account and connected services">
        <LegalList
          items={[
            {
              body: "You are responsible for keeping your account secure and for activity that happens under it.",
            },
            {
              body: "When you connect a service (Google, Canvas, Notion, your calendars, and others), you authorize Jarvis to access the data needed to provide its features, as described in the Privacy Policy.",
            },
            {
              body: "You confirm you have the right to connect those accounts and share that data with Jarvis.",
            },
            {
              body: "You can disconnect any service, or stop using Jarvis, at any time.",
            },
          ]}
        />
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>You agree not to:</p>
        <LegalList
          items={[
            { body: "Use Jarvis for anything unlawful, or to access data you are not authorized to access." },
            { body: "Attempt to break, overload, reverse-engineer, or disrupt the service or its infrastructure." },
            { body: "Resell or redistribute the service without permission." },
          ]}
        />
      </LegalSection>

      <LegalSection heading="No warranty">
        <p>
          Jarvis is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of
          any kind. Jarvis helps you organize your work, but it can be wrong, incomplete, or delayed —
          you remain responsible for your own deadlines, decisions, and commitments. Do not rely on
          Jarvis as your only safeguard for anything important.
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Jarvis and its operator will not be liable for any
          indirect, incidental, or consequential damages, or for any missed deadline, lost data, or
          lost opportunity, arising from your use of (or inability to use) the service.
        </p>
      </LegalSection>

      <LegalSection heading="Termination">
        <p>
          You may stop using Jarvis at any time. We may suspend or end access if these terms are
          violated or if needed to protect the service or its users.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to these terms">
        <p>
          We may update these terms as Jarvis evolves. When we make material changes, we will update
          the date above. Continuing to use Jarvis after a change means you accept the updated terms.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law">
        <p>These terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict-of-law rules.</p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about these terms? Email{" "}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
