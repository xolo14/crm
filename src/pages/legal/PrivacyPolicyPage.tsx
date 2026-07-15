import { useEffect } from "react";
import { Link } from "react-router-dom";
import LegalPageLayout from "@/components/legal/LegalPageLayout";
import { LEGAL_SITE_NAME, TERMS_OF_SERVICE_PATH, privacyPolicyUrl } from "@/lib/siteLegal";
import { setPageMeta } from "@/lib/seo";

const LAST_UPDATED = "July 7, 2026";

export default function PrivacyPolicyPage() {
  useEffect(() => {
    setPageMeta({
      title: `Privacy Policy — ${LEGAL_SITE_NAME}`,
      description: `How ${LEGAL_SITE_NAME} collects, uses, and protects personal data in the Syncpedia CRM, including WhatsApp Business messaging.`,
      canonical: privacyPolicyUrl(),
      robots: "index, follow",
    });
  }, []);

  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <p>
        This Privacy Policy describes how <strong>{LEGAL_SITE_NAME}</strong> (“we”, “us”, “our”) collects,
        uses, stores, and shares information when you use the Syncpedia CRM platform at{" "}
        <strong>crm.syncpedia.in</strong> (the “Service”), including lead forms, customer communications,
        and WhatsApp Business API integrations operated on behalf of our partner organizations.
      </p>

      <h2>1. Who we are</h2>
      <p>
        {LEGAL_SITE_NAME} provides customer relationship management (CRM) software for training institutes,
        education partners, and businesses. The Service is used by authorized staff of partner organizations
        and, where applicable, by individuals who submit enquiries through public forms or communicate via
        WhatsApp.
      </p>
      <p>
        <strong>Contact:</strong> support@syncpedia.in
      </p>

      <h2>2. Information we collect</h2>
      <p>Depending on how you interact with the Service, we may collect:</p>
      <ul>
        <li>
          <strong>Account data</strong> — name, work email, role, organization affiliation, and login credentials
          for CRM users.
        </li>
        <li>
          <strong>Lead &amp; customer data</strong> — names, phone numbers, email addresses, course interests,
          form responses, resumes, and notes entered by partner organizations.
        </li>
        <li>
          <strong>WhatsApp &amp; messaging data</strong> — phone numbers, message content (text and media metadata),
          delivery/read status, and timestamps when organizations connect Meta WhatsApp Cloud API to the CRM.
        </li>
        <li>
          <strong>Technical data</strong> — IP address, browser type, device information, and server logs for
          security and troubleshooting.
        </li>
        <li>
          <strong>Payment-related data</strong> — where payment links are used, transaction references processed
          through third-party payment providers (we do not store full card numbers).
        </li>
      </ul>

      <h2>3. How we use information</h2>
      <p>We use collected information to:</p>
      <ul>
        <li>Provide, operate, and improve the CRM and related features;</li>
        <li>Route leads, tasks, and communications to the correct organization and staff;</li>
        <li>Send and receive WhatsApp messages on behalf of organizations that have enabled Meta integration;</li>
        <li>Authenticate users and protect against fraud or abuse;</li>
        <li>Comply with legal obligations and respond to lawful requests.</li>
      </ul>

      <h2>4. WhatsApp &amp; Meta</h2>
      <p>
        When an organization connects <strong>Meta WhatsApp Business API</strong> to the CRM, message data is
        processed to deliver customer support, notifications, and template messages. Meta processes data
        according to its own policies. We access WhatsApp data only as instructed by the organization using
        the Service and as required to provide CRM functionality (inbox, lead linking, message history, delivery
        status).
      </p>
      <p>
        Organizations are responsible for obtaining appropriate consent from their customers before messaging
        them on WhatsApp, and for using approved message templates where required by Meta.
      </p>

      <h2>5. Legal bases (where applicable)</h2>
      <p>
        For users in regions where data-protection law applies, we rely on: performance of a contract (providing
        the Service), legitimate interests (security, product improvement), and consent where required (e.g.
        marketing communications or optional form fields).
      </p>

      <h2>6. Sharing of information</h2>
      <p>We may share information with:</p>
      <ul>
        <li>
          <strong>Partner organizations</strong> — lead and customer data submitted to or managed within their
          CRM workspace;
        </li>
        <li>
          <strong>Service providers</strong> — hosting (e.g. cloud servers), email delivery, payment processors,
          and Meta/WhatsApp for messaging;
        </li>
        <li>
          <strong>Legal authorities</strong> — when required by law or to protect rights and safety.
        </li>
      </ul>
      <p>We do not sell personal information.</p>

      <h2>7. Data retention</h2>
      <p>
        We retain data for as long as an organization’s account is active or as needed to provide the Service,
        comply with law, resolve disputes, and enforce agreements. Organizations may request deletion of leads
        or messages subject to their admin permissions and applicable law.
      </p>

      <h2>8. Security</h2>
      <p>
        We use industry-standard measures including HTTPS encryption, access controls, and secure credential
        storage. No method of transmission over the Internet is 100% secure; we cannot guarantee absolute
        security.
      </p>

      <h2>9. Your rights</h2>
      <p>
        Depending on your location, you may have rights to access, correct, delete, or restrict processing of
        your personal data. CRM end-customers should contact the organization they interacted with first;
        you may also contact us at <strong>support@syncpedia.in</strong>.
      </p>

      <h2>10. Children</h2>
      <p>
        The Service is not directed at children under 13. Partner organizations that collect student enquiries
        must comply with applicable laws regarding minors.
      </p>

      <h2>11. Changes</h2>
      <p>
        We may update this policy from time to time. The “Last updated” date at the top will reflect changes.
        Continued use of the Service after updates constitutes acceptance of the revised policy.
      </p>

      <h2>12. Related documents</h2>
      <p>
        See also our <Link to={TERMS_OF_SERVICE_PATH}>Terms of Service</Link>.
      </p>
    </LegalPageLayout>
  );
}
