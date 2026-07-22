import type { Metadata } from "next";
import { InfoPage } from "@/components/marketing/InfoPage";

export const metadata: Metadata = {
  title: "Privacy Policy — bando",
  description: "How bando collects, uses and protects your data.",
};

export default function PrivacyPage() {
  return (
    <InfoPage
      title="Privacy Policy"
      updated="June 2026"
      lead="This page explains what data bando collects, why, and the choices you have. We keep it to what the service actually needs."
    >
      <h2>What we collect</h2>
      <ul>
        <li><strong>Account data</strong> — your email and, optionally, your name, used to sign you in and identify your account.</li>
        <li><strong>Test activity</strong> — the tests you take, your answers, scores, streaks, rating and badges, so we can show your progress and analytics.</li>
        <li><strong>Technical data</strong> — basic device and usage information needed to run the service and diagnose errors.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your data to provide the trainer: grade your tests, show your per-type breakdown and progress, run the
        leaderboard and badges, and process upgrades. We do not sell your personal data.
      </p>

      <h2>Authentication, analytics &amp; errors</h2>
      <p>
        Authentication is handled by <strong>Supabase</strong>. We use privacy-conscious product analytics
        (<strong>PostHog</strong>) and error monitoring (<strong>Sentry</strong>) to understand how the product is used
        and to fix problems. Session replay and autocapture are off, and exam and auth URLs are stripped of query data.
      </p>

      <h2>Data storage</h2>
      <p>
        Your data is stored with our infrastructure providers and protected by row-level security so you can only access
        your own records. We retain it for as long as your account is active.
      </p>

      <h2>Your rights</h2>
      <p>
        You can request access to, correction of, or deletion of your personal data. Email
        <a href="mailto:privacy@bando.app"> privacy@bando.app</a> and we&apos;ll help.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about this policy? Reach us at <a href="mailto:privacy@bando.app">privacy@bando.app</a>.
      </p>
    </InfoPage>
  );
}
