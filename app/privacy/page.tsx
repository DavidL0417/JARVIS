import type { Metadata } from "next"

import { LegalLink, LegalList, LegalSection, LegalShell } from "@/components/legal/legal-shell"

const CONTACT_EMAIL = "davidxizhenliu@gmail.com"
const LAST_UPDATED = "June 21, 2026"

export const metadata: Metadata = {
  title: "Privacy Policy — Jarvis",
  description:
    "How Jarvis collects, uses, stores, and protects your data, including data accessed from Google, Canvas, Notion, and your calendars.",
}

export default function PrivacyPage() {
  return (
    <LegalShell
      title="Privacy Policy"
      lastUpdated={LAST_UPDATED}
      intro={
        <>
          <p>
            Jarvis is a personal assistant that reads the tools you already use — your calendar,
            email, coursework, and notes — and turns them into a single, current picture of what you
            need to do next. Operating that assistant means handling data on your behalf, and this
            policy explains exactly what we access, why, where it goes, and how you stay in control.
          </p>
          <p>
            Jarvis is operated by David (Xizhen) Liu as a sole proprietor (&ldquo;Jarvis,&rdquo;
            &ldquo;we,&rdquo; &ldquo;us&rdquo;). If anything here is unclear, email{" "}
            <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>.
          </p>
        </>
      }
    >
      <LegalSection heading="Information we collect">
        <p>We only collect what is needed to run the assistant for you:</p>
        <LegalList
          items={[
            {
              label: "Account information.",
              body: "Your name and email address, provided when you sign in (for example, through Google sign-in).",
            },
            {
              label: "Data from services you connect.",
              body: "When you authorize an integration, Jarvis reads the relevant data from it — deadlines and coursework from Canvas, tasks and pages from Notion, events from Google Calendar and Apple/CalDAV calendars, tasks from Todoist, and messages from Gmail. You choose which services to connect, and you can disconnect any of them at any time.",
            },
            {
              label: "Content you provide.",
              body: "Files, notes, or text you upload or paste in for planning.",
            },
            {
              label: "Usage data.",
              body: "Basic, privacy-respecting analytics about how the app is used (for example, page views) so we can keep it working and improve it.",
            },
          ]}
        />
      </LegalSection>

      <LegalSection heading="How we use your information">
        <p>Your data is used solely to provide the assistant&rsquo;s features to you:</p>
        <LegalList
          items={[
            { body: "Build and keep current your schedule, task list, and daily plan." },
            { body: "Surface deadlines, conflicts, and the next thing you should work on." },
            {
              body: "Send you the updates you ask for — for example, a morning plan or an evening reminder by text — and only while the assistant is active (not paused).",
            },
            { body: "Answer your questions about your own schedule, messages, and tasks." },
          ]}
        />
        <p>
          We do <span className="font-medium text-foreground">not</span> sell your data, use it for
          advertising, or use it to build or train generalized AI/ML models.
        </p>
      </LegalSection>

      <LegalSection id="google" heading="Google user data">
        <p>
          If you connect a Google account, Jarvis requests only the access it needs, and uses each
          permission for one specific purpose:
        </p>
        <LegalList
          items={[
            {
              label: "Google Calendar (read).",
              body: "To read your events so your plan reflects your real schedule.",
            },
            {
              label: "Google Calendar (events).",
              body: "To add or update the task blocks you ask Jarvis to put on your calendar. Jarvis does not touch events it did not create.",
            },
            {
              label: "Gmail (read-only).",
              body: "To find obligations and context buried in your email (a deadline, an assignment, a reply you owe) and surface them. Jarvis cannot send, modify, or delete your email.",
            },
          ]}
        />
        <p>
          Jarvis&rsquo;s use and transfer to any other app of information received from Google APIs
          will adhere to the{" "}
          <LegalLink href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </LegalLink>
          , including the Limited Use requirements. You can review or revoke Jarvis&rsquo;s access to
          your Google account at any time at{" "}
          <LegalLink href="https://myaccount.google.com/permissions">
            myaccount.google.com/permissions
          </LegalLink>
          .
        </p>
      </LegalSection>

      <LegalSection heading="AI processing">
        <p>
          To generate plans, summaries, and answers, Jarvis sends the relevant content to Anthropic
          (the maker of Claude) for processing. This data is used only to produce a result for you;
          under Anthropic&rsquo;s terms it is not used to train their models. It is processed to serve
          your request and not retained by the model provider for other purposes.
        </p>
      </LegalSection>

      <LegalSection heading="How we store and protect your data">
        <p>
          Your data is stored in our database hosted by Supabase, with access restricted to your own
          account. Data is encrypted in transit, access tokens for connected services are stored with
          restricted access, and only the operator may access systems for security, debugging, or
          legal reasons. No system is perfectly secure, but we limit what we collect and who can reach
          it.
        </p>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>
          We do not sell your data. We share it only with the service providers that make Jarvis run,
          and only as needed to operate the assistant:
        </p>
        <LegalList
          items={[
            { label: "Supabase —", body: "database and authentication." },
            { label: "Vercel —", body: "application hosting." },
            { label: "Anthropic —", body: "AI processing (see above)." },
            { label: "Telnyx —", body: "delivering text-message updates, if you enable them." },
            {
              label: "Services you connect —",
              body: "Google, Notion, Instructure (Canvas), Todoist, and others, only to read or write the data you authorized.",
            },
          ]}
        />
        <p>We may also disclose data if required by law.</p>
      </LegalSection>

      <LegalSection heading="Retention and deletion">
        <p>
          You stay in control of your data:
        </p>
        <LegalList
          items={[
            {
              label: "Disconnect a source.",
              body: "Removing an integration stops further access and removes its stored tokens.",
            },
            {
              label: "Delete your account.",
              body: `Email ${CONTACT_EMAIL} and we will delete your account and associated data.`,
            },
            {
              label: "Revoke Google access.",
              body: "Use myaccount.google.com/permissions at any time, independently of Jarvis.",
            },
          ]}
        />
      </LegalSection>

      <LegalSection heading="Students and younger users">
        <p>
          Jarvis is built with students in mind and is not directed to children under 13. If you are
          under the age of majority where you live, please use Jarvis only with the involvement of a
          parent, guardian, or your school.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          We may update this policy as Jarvis evolves. When we make material changes, we will update
          the date above and, where appropriate, notify you.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about your privacy or this policy? Email{" "}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>.
        </p>
      </LegalSection>
    </LegalShell>
  )
}
