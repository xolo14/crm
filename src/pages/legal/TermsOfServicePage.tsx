import { useEffect } from "react";
import { Link } from "react-router-dom";
import LegalPageLayout from "@/components/legal/LegalPageLayout";
import { LEGAL_SITE_NAME, PRIVACY_POLICY_PATH, termsOfServiceUrl } from "@/lib/siteLegal";
import { setPageMeta } from "@/lib/seo";

const LAST_UPDATED = "July 7, 2026";

export default function TermsOfServicePage() {
  useEffect(() => {
    setPageMeta({
      title: `Terms of Service — ${LEGAL_SITE_NAME}`,
      description: `Terms governing use of the Syncpedia CRM platform and related services.`,
      canonical: termsOfServiceUrl(),
      robots: "index, follow",
    });
  }, []);

  return (
    <LegalPageLayout title="Terms of Service" lastUpdated={LAST_UPDATED}>
      <p>
        These Terms of Service (“Terms”) govern access to and use of the Syncpedia CRM platform
        (“Service”) provided by <strong>{LEGAL_SITE_NAME}</strong>. By using the Service, you agree to these
        Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        The Service is a business CRM for lead management, communications, forms, and optional integrations
        including Meta WhatsApp Cloud API. Features may vary by organization and subscription.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You must provide accurate information when creating an account. You are responsible for safeguarding
        login credentials and for all activity under your account. Notify us promptly of unauthorized access.
      </p>

      <h2>3. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for unlawful, harmful, or spam activity;</li>
        <li>Violate WhatsApp/Meta messaging policies or send unapproved marketing without consent;</li>
        <li>Attempt to breach security or access data belonging to other organizations;</li>
        <li>Reverse engineer or resell the Service without written permission.</li>
      </ul>

      <h2>4. Organization data</h2>
      <p>
        Partner organizations control the customer and lead data in their workspace. {LEGAL_SITE_NAME} processes
        such data on the organization’s instructions as a service provider.
      </p>

      <h2>5. Third-party services</h2>
      <p>
        Integrations (Meta, payment gateways, email providers) are subject to their own terms. You are
        responsible for configuring and complying with those providers.
      </p>

      <h2>6. Availability</h2>
      <p>
        We strive for reliable uptime but do not guarantee uninterrupted access. Maintenance, updates, or
        third-party outages may cause temporary unavailability.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, {LEGAL_SITE_NAME} is not liable for indirect, incidental, or
        consequential damages arising from use of the Service. Our total liability is limited to fees paid
        for the Service in the twelve months preceding the claim, or INR 10,000, whichever is greater.
      </p>

      <h2>8. Termination</h2>
      <p>
        We may suspend or terminate access for violation of these Terms or for non-payment. Organizations may
        discontinue use at any time subject to their agreement with us.
      </p>

      <h2>9. Governing law</h2>
      <p>
        These Terms are governed by the laws of India. Courts in Hyderabad, Telangana shall have exclusive
        jurisdiction, subject to applicable consumer protection laws.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions: <strong>support@syncpedia.in</strong>
      </p>

      <h2>11. Privacy</h2>
      <p>
        Our <Link to={PRIVACY_POLICY_PATH}>Privacy Policy</Link> explains how we handle personal data.
      </p>
    </LegalPageLayout>
  );
}
