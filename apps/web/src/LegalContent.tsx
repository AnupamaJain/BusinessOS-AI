import React from 'react';
import { ArrowLeft } from 'lucide-react';

/* ── Palette (kept in sync with LandingPage's C) ── */
const C = {
  bg: '#070a0f',
  raised: '#0a0e15',
  card: '#0e1420',
  line: 'rgba(255,255,255,0.08)',
  lineSoft: 'rgba(255,255,255,0.05)',
  cyan: '#00e5ff',
  text: '#eef2f7',
  muted: '#94a3b8',
  faint: '#5f6d7e',
};
const MEASURE = 680;
const UPDATED = '21 July 2026';
const CONTACT = 'legal@saarthione.com';

interface LegalProps {
  onBack: () => void;
}

/* ─── Shared building blocks ─────────────────────────────────────────── */
function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1 style={{ fontSize: '38px', fontWeight: 800, fontFamily: 'Outfit, sans-serif', letterSpacing: '-1px', lineHeight: 1.14, color: '#fff', marginBottom: '10px' }}>
      {children}
    </h1>
  );
}

function Updated() {
  return (
    <div style={{ color: C.faint, fontSize: '13px', fontFamily: 'monospace', letterSpacing: '0.04em', marginBottom: '40px' }}>
      Last updated: {UPDATED}
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '34px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'Outfit, sans-serif', color: C.cyan, letterSpacing: '-0.3px', marginBottom: '14px', display: 'flex', alignItems: 'baseline', gap: '10px' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '13px', color: C.faint, fontWeight: 700 }}>{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

const pStyle: React.CSSProperties = { color: C.muted, fontSize: '15px', lineHeight: 1.7, marginBottom: '14px' };
function P({ children }: { children: React.ReactNode }) {
  return <p style={pStyle}>{children}</p>;
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: '0 0 16px', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {items.map((it, i) => (
        <li key={i} style={{ color: C.muted, fontSize: '15px', lineHeight: 1.65, display: 'flex', gap: '11px', alignItems: 'flex-start' }}>
          <span style={{ color: C.cyan, flexShrink: 0, marginTop: '1px', fontSize: '13px' }}>▸</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/* ─── Page chrome (shared shell for both documents) ──────────────────── */
function LegalShell({ onBack, children }: { onBack: () => void; children: React.ReactNode }) {
  return (
    <div style={{ backgroundColor: C.bg, color: C.text, minHeight: '100vh', fontFamily: 'Inter, sans-serif', overflowX: 'hidden' }}>
      {/* Top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 100, backdropFilter: 'blur(16px)', backgroundColor: 'rgba(7,10,15,0.82)', borderBottom: `1px solid ${C.line}`, padding: '15px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
        <button
          onClick={onBack}
          onMouseEnter={(e) => (e.currentTarget.style.color = C.text)}
          onMouseLeave={(e) => (e.currentTarget.style.color = C.muted)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'transparent', border: `1px solid ${C.lineSoft}`, borderRadius: '10px', padding: '9px 15px', color: C.muted, fontSize: '14px', fontWeight: 600, cursor: 'pointer', transition: 'color 0.2s', fontFamily: 'Inter, sans-serif' }}
        >
          <ArrowLeft size={16} /> Back to home
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={onBack}>
          <img src="/saarthione-peacock-feather-v2.png" alt="SaarthiOne" width={28} height={28} style={{ borderRadius: '7px' }} />
          <span style={{ fontFamily: 'Outfit, sans-serif', fontWeight: 800, fontSize: '19px', letterSpacing: '-0.5px' }}>
            Saarthi<span style={{ color: C.cyan }}>One</span>
          </span>
        </div>
      </div>

      {/* Body */}
      <main style={{ maxWidth: `${MEASURE}px`, margin: '0 auto', padding: '56px 24px 96px' }}>
        {children}
      </main>

      {/* Footer note */}
      <footer style={{ borderTop: `1px solid ${C.line}`, backgroundColor: '#04070b', padding: '28px 24px' }}>
        <div style={{ maxWidth: `${MEASURE}px`, margin: '0 auto', color: C.faint, fontSize: '12.5px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
          <span>© 2026 SaarthiOne. All rights reserved.</span>
          <span>
            Questions? <a href={`mailto:${CONTACT}`} style={{ color: C.cyan, textDecoration: 'none' }}>{CONTACT}</a>
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   PRIVACY POLICY
   ═══════════════════════════════════════════════════════════════════════ */
export function PrivacyPolicy({ onBack }: LegalProps) {
  return (
    <LegalShell onBack={onBack}>
      <H1>Privacy Policy</H1>
      <Updated />

      <P>
        SaarthiOne (“SaarthiOne”, “we”, “us”) provides an AI-powered platform that lets small and medium
        businesses (“Businesses”, “you”) run sales, support, bookings and payments over the WhatsApp Business
        Platform. This policy explains what personal data we collect, why, how we protect it, and the rights
        you and your customers have. It applies to our website, dashboard and messaging services.
      </P>
      <P>
        Two kinds of people are described here: the <b>Business</b> that signs up for SaarthiOne, and the
        <b> end-customers</b> who message that Business over WhatsApp. For end-customer data, the Business is
        the data controller (it decides why the data is processed) and SaarthiOne acts as its processor,
        handling the data on the Business’s instructions.
      </P>

      <Section n="01" title="Information we collect">
        <P>We collect only what is needed to run the service:</P>
        <List
          items={[
            <><b>Business account data</b> — name, business name, email, phone number, WhatsApp Business number, vertical, and login credentials.</>,
            <><b>End-customer contact information</b> — the phone number, display name and any profile details a customer shares when they message your Business.</>,
            <><b>WhatsApp message content</b> — the text, images, documents and voice notes exchanged in conversations your AI teammate handles, so it can reply, quote, book and follow up.</>,
            <><b>Payment metadata</b> — the amount, currency, order reference, status and timestamp of transactions. Card numbers, UPI handles and bank credentials are entered directly with our payment processor (Razorpay) and are never stored on SaarthiOne’s servers.</>,
            <><b>Catalogue &amp; knowledge data</b> — products, prices, policies and documents you upload so the AI can answer accurately.</>,
            <><b>Usage &amp; technical data</b> — log events, device and browser information, IP address and cookies used to keep you signed in and to secure and improve the service.</>,
          ]}
        />
      </Section>

      <Section n="02" title="How we use your information">
        <List
          items={[
            'To deliver the core service — routing messages, generating AI replies grounded in your catalogue, creating quotes, scheduling bookings and issuing payment links.',
            'To process payments and reconcile transactions through our payment processor.',
            'To send operational messages, reminders and receipts, subject to the customer’s consent state.',
            'To provide analytics, a shared team inbox and human-in-the-loop handoff.',
            'To secure the platform, prevent abuse and fraud, and debug problems.',
            'To meet legal, tax and regulatory obligations.',
          ]}
        />
        <P>We do not sell personal data, and we do not use end-customer message content to train third-party foundation models.</P>
      </Section>

      <Section n="03" title="Legal basis &amp; consent">
        <P>
          Where applicable data-protection law requires a legal basis, we rely on: performance of our contract
          with the Business; the legitimate interests of the Business in communicating with people who have
          contacted it; compliance with legal obligations; and consent.
        </P>
        <P>
          WhatsApp messaging is consent-first. Every end-customer contact carries an opt-in state, and each
          Business is responsible for obtaining the consent required to message its customers. Business-initiated
          follow-ups are only sent to opted-in contacts and within a 09:00–21:00 local window. Customers can opt
          out at any time by replying to stop.
        </P>
      </Section>

      <Section n="04" title="Sub-processors we share data with">
        <P>We share the minimum data needed with vetted providers that act on our behalf:</P>
        <List
          items={[
            <><b>Meta Platforms / WhatsApp</b> — the official WhatsApp Business Platform (Cloud API) that delivers messages between you and your customers.</>,
            <><b>Razorpay</b> — our PCI-DSS-compliant payment processor, which handles card, UPI and net-banking details and returns only transaction metadata to us.</>,
            <><b>Large-language-model providers</b> — enterprise LLM APIs that generate AI replies. Message content is sent for the sole purpose of producing a response and is processed under agreements that prohibit using it to train their models.</>,
            <><b>Cloud infrastructure &amp; database hosting</b> — providers that host the encrypted application and data, and email-delivery services for operational notifications.</>,
          ]}
        />
        <P>Each sub-processor is bound by contractual confidentiality and data-protection terms. We do not permit them to use the data for their own purposes.</P>
      </Section>

      <Section n="05" title="Data retention">
        <P>
          We keep personal data only as long as needed for the purposes above or as required by law. Account and
          conversation data is retained while your Business account is active. Payment and invoice records are
          retained for the period required by Indian tax and accounting law. When you close your account, we
          delete or anonymise personal data within 90 days, except records we are legally required to keep. A
          Business can trigger export or deletion of an individual customer’s data at any time (see “Your rights”).
        </P>
      </Section>

      <Section n="06" title="How we protect your data">
        <List
          items={[
            <><b>Encryption at rest</b> — access tokens and secrets are sealed with AES-256-GCM; data is encrypted at rest and in transit (TLS).</>,
            <><b>Tenant isolation</b> — every Business’s data is isolated using database row-level security (RLS), so one Business can never read another’s records.</>,
            <><b>Access controls</b> — least-privilege access, authenticated sessions and audit logging. Only authorised personnel can access production systems, and only when necessary to operate or support the service.</>,
            <><b>Safety gates</b> — automated guardrails block risky claims and hand conversations to a human when needed.</>,
          ]}
        />
        <P>No system is perfectly secure, but we work continuously to protect your data and will notify affected parties and regulators of a breach as required by law.</P>
      </Section>

      <Section n="07" title="Your rights">
        <P>
          Depending on your location, you and your end-customers may have the right to access, correct, export,
          restrict or delete personal data, and to object to certain processing. SaarthiOne exposes built-in
          tools for this: a Business can, from its dashboard, <b>export</b> a machine-readable copy of any
          customer’s data and <b>erase</b> that customer on request — designed for GDPR-style and India DPDP-style
          data requests. To exercise rights over your own Business-account data, or if you are an end-customer who
          cannot reach the Business, contact us at{' '}
          <a href={`mailto:${CONTACT}`} style={{ color: C.cyan, textDecoration: 'none' }}>{CONTACT}</a>.
        </P>
      </Section>

      <Section n="08" title="International data transfers">
        <P>
          SaarthiOne primarily processes data on infrastructure serving India. Some sub-processors (for example
          WhatsApp/Meta and LLM providers) may process data on servers located outside India. Where data crosses
          borders, we rely on appropriate safeguards — such as standard contractual clauses and the providers’ own
          compliance frameworks — to protect it consistently with this policy.
        </P>
      </Section>

      <Section n="09" title="Children">
        <P>
          SaarthiOne is a business tool and is not directed to children. It is not intended for use by anyone under
          18, and we do not knowingly collect personal data from children. If you believe a child’s data has been
          provided to us, contact us and we will delete it.
        </P>
      </Section>

      <Section n="10" title="Changes to this policy">
        <P>
          We may update this policy as the service evolves or the law changes. We will post the revised version here
          with a new “last updated” date and, for material changes, notify Businesses through the dashboard or by
          email. Continued use of the service after an update means you accept the revised policy.
        </P>
      </Section>

      <Section n="11" title="Contact us">
        <P>
          For any privacy question or request, email{' '}
          <a href={`mailto:${CONTACT}`} style={{ color: C.cyan, textDecoration: 'none' }}>{CONTACT}</a>. We aim to
          respond to data-rights requests within 30 days.
        </P>
      </Section>
    </LegalShell>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TERMS OF SERVICE
   ═══════════════════════════════════════════════════════════════════════ */
export function TermsOfService({ onBack }: LegalProps) {
  return (
    <LegalShell onBack={onBack}>
      <H1>Terms of Service</H1>
      <Updated />

      <P>
        These Terms of Service (“Terms”) govern your access to and use of SaarthiOne — the AI-powered platform for
        running sales, support, bookings and payments over the WhatsApp Business Platform — including our website,
        dashboard and messaging services (together, the “Service”). Please read them carefully.
      </P>

      <Section n="01" title="Acceptance of terms">
        <P>
          By creating an account, or by accessing or using the Service, you agree to be bound by these Terms and by
          our Privacy Policy. If you are using the Service on behalf of a business, you represent that you are
          authorised to bind that business, and “you” refers to that business. If you do not agree, do not use the
          Service.
        </P>
      </Section>

      <Section n="02" title="Description of the service">
        <P>
          SaarthiOne connects your WhatsApp Business number to an AI teammate that can qualify leads, answer
          questions grounded in your catalogue and policies, generate quotes, schedule bookings, send payment links
          and follow up — with human oversight through a shared inbox. Features vary by plan and may change over
          time as we improve the Service.
        </P>
      </Section>

      <Section n="03" title="Accounts &amp; eligibility">
        <P>
          You must be at least 18 years old and operating a legitimate business to use the Service. You agree to
          provide accurate information, keep your credentials secure, and are responsible for all activity under
          your account. Notify us promptly of any unauthorised use.
        </P>
      </Section>

      <Section n="04" title="Acceptable use">
        <P>You agree not to use the Service to:</P>
        <List
          items={[
            'Send spam, unsolicited messages, or message people who have not consented to hear from you.',
            'Violate the WhatsApp Business Terms, Meta’s Business and Commerce policies, or applicable messaging and marketing laws.',
            'Send unlawful, fraudulent, deceptive, harassing, hateful or infringing content.',
            'Attempt to reverse-engineer, disrupt, overload, or gain unauthorised access to the Service or its infrastructure.',
            'Resell or misrepresent the Service, or use it to build a competing product.',
          ]}
        />
        <P>We may suspend accounts that violate these rules or that put our messaging access at risk.</P>
      </Section>

      <Section n="05" title="Your responsibilities">
        <List
          items={[
            <><b>Consent</b> — you are solely responsible for obtaining valid consent to message your end-customers and for honouring opt-outs.</>,
            <><b>Platform compliance</b> — you must comply with the WhatsApp Business Platform policies, Meta’s Commerce and messaging policies, and all applicable laws in the places you operate.</>,
            <><b>Accuracy of content</b> — you are responsible for the catalogue, prices, policies and knowledge you provide, and for the offers your AI teammate makes on your behalf.</>,
            <><b>Your customers’ data</b> — you are the controller of your end-customers’ data and must handle it lawfully; SaarthiOne processes it on your instructions as described in the Privacy Policy.</>,
          ]}
        />
      </Section>

      <Section n="06" title="Fees &amp; billing">
        <P>
          The Service is offered on subscription plans billed per business, per month: <b>Starter ₹999</b>,{' '}
          <b>Growth ₹2,999</b> and <b>Scale ₹7,999</b>. Plans and their limits are described on our pricing page and
          may change on notice. Subscriptions renew automatically each billing cycle until cancelled; you can cancel
          at any time and cancellation takes effect at the end of the current cycle.
        </P>
        <List
          items={[
            <><b>Meta conversation charges</b> — WhatsApp conversation fees set by Meta are billed to you separately, at cost, in addition to your subscription.</>,
            <><b>Taxes</b> — all fees are exclusive of GST and other applicable taxes, which will be added where required.</>,
            'Except where required by law, fees already paid are non-refundable. Late or failed payments may lead to suspension of the Service.',
          ]}
        />
      </Section>

      <Section n="07" title="Payment processing">
        <P>
          Payments — both your subscription and the payment links your AI teammate sends to your customers — are
          processed by <b>Razorpay</b>, our third-party payment processor. Your and your customers’ payment details
          are handled by Razorpay under its own terms and PCI-DSS compliance; SaarthiOne does not store full card,
          UPI or bank credentials. We are not responsible for the acts, omissions or availability of the payment
          processor.
        </P>
      </Section>

      <Section n="08" title="AI output disclaimer">
        <P>
          The Service uses AI to generate replies, quotes and recommendations. While answers are grounded in your
          own catalogue and policies and protected by safety gates, AI can still make mistakes, misinterpret a
          request, or produce inaccurate output. You are responsible for the messages sent from your account. We
          strongly recommend human oversight for important, high-value or sensitive conversations, and the Service
          provides one-tap human handoff for this purpose. AI output is not professional, legal, medical or
          financial advice.
        </P>
      </Section>

      <Section n="09" title="Intellectual property">
        <P>
          SaarthiOne and all associated software, designs and trademarks are owned by us and our licensors. We grant
          you a limited, non-exclusive, non-transferable right to use the Service during your subscription. You
          retain ownership of the content and data you provide (“Your Content”), and you grant us the limited licence
          needed to host and process it to operate the Service on your behalf.
        </P>
      </Section>

      <Section n="10" title="Warranties &amp; disclaimer">
        <P>
          The Service is provided “as is” and “as available”, without warranties of any kind, whether express or
          implied, including fitness for a particular purpose, merchantability, non-infringement, or uninterrupted or
          error-free operation. We do not warrant that the Service, its messaging deliverability, or third-party
          platforms will always be available.
        </P>
      </Section>

      <Section n="11" title="Limitation of liability">
        <P>
          To the maximum extent permitted by law, SaarthiOne and its officers, employees and suppliers will not be
          liable for any indirect, incidental, special, consequential or punitive damages, or for lost profits,
          revenue, data or goodwill. Our total aggregate liability arising out of or relating to the Service will not
          exceed the total fees you paid to us in the three (3) months immediately before the event giving rise to the
          claim.
        </P>
      </Section>

      <Section n="12" title="Indemnity">
        <P>
          You agree to indemnify and hold harmless SaarthiOne from any claims, damages, losses and expenses (including
          reasonable legal fees) arising out of your use of the Service, your content, your messages to end-customers,
          your lack of required consent, or your breach of these Terms or of any law or third-party platform policy.
        </P>
      </Section>

      <Section n="13" title="Termination">
        <P>
          You may stop using and cancel the Service at any time. We may suspend or terminate your access if you breach
          these Terms, fail to pay, or create risk for the Service or its platform partners. On termination, your right
          to use the Service ends; you can export your data for a limited period, after which it will be deleted or
          anonymised as described in the Privacy Policy. Provisions that by their nature should survive termination
          (such as fees owed, IP, disclaimers, liability limits and indemnity) will survive.
        </P>
      </Section>

      <Section n="14" title="Governing law &amp; jurisdiction">
        <P>
          These Terms are governed by the laws of India. You agree that the courts of Bengaluru, Karnataka, will have
          exclusive jurisdiction over any dispute arising out of or relating to these Terms or the Service, and you
          submit to the personal jurisdiction of those courts.
        </P>
      </Section>

      <Section n="15" title="Changes to these terms">
        <P>
          We may update these Terms from time to time. We will post the revised version here with a new “last updated”
          date and, for material changes, notify you through the dashboard or by email. Continued use of the Service
          after an update means you accept the revised Terms.
        </P>
      </Section>

      <Section n="16" title="Contact us">
        <P>
          Questions about these Terms? Email{' '}
          <a href={`mailto:${CONTACT}`} style={{ color: C.cyan, textDecoration: 'none' }}>{CONTACT}</a>.
        </P>
      </Section>
    </LegalShell>
  );
}
