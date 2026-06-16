import type { Metadata } from "next";
import { InfoPage } from "@/components/marketing/InfoPage";

export const metadata: Metadata = {
  title: "Terms of Service — bando",
  description: "The terms that govern your use of bando.",
};

export default function TermsPage() {
  return (
    <InfoPage
      title="Terms of Service"
      updated="June 2026"
      lead="By using bando you agree to these terms. They&apos;re written to be readable; the short version is: use the service fairly and we&apos;ll keep it running."
    >
      <h2>1. Acceptance</h2>
      <p>By creating an account or using bando, you agree to these Terms. If you don&apos;t agree, please don&apos;t use the service.</p>

      <h2>2. The service</h2>
      <p>bando provides IELTS Reading and Listening practice tests with automated grading and progress analytics. Practice results are an estimate to help you prepare; they are not official IELTS scores and are not affiliated with or endorsed by the IELTS organisations.</p>

      <h2>3. Your account</h2>
      <p>You&apos;re responsible for keeping your login credentials secure and for activity under your account. Provide accurate information when you sign up, and one account per person.</p>

      <h2>4. Acceptable use</h2>
      <ul>
        <li>Don&apos;t attempt to cheat the grading, ratings or leaderboard, or abuse referrals.</li>
        <li>Don&apos;t copy, scrape or redistribute test content.</li>
        <li>Don&apos;t disrupt, probe or reverse-engineer the service.</li>
      </ul>

      <h2>5. Plans and payments</h2>
      <p>Some features require a paid tier. Pricing and limits are shown on the upgrade page. Paid access lasts for the period you purchased; entitlements are granted only after a confirmed payment.</p>

      <h2>6. Content and intellectual property</h2>
      <p>Test content and the bando software are owned by us or our licensors and are protected by intellectual-property law. We grant you a personal, non-transferable right to use them for your own exam preparation.</p>

      <h2>7. Disclaimers</h2>
      <p>The service is provided &quot;as is&quot;. We work to keep it accurate and available, but we don&apos;t guarantee a particular IELTS outcome, uninterrupted access, or that every result is error-free.</p>

      <h2>8. Changes</h2>
      <p>We may update these Terms as the product evolves. Material changes will be reflected by the &quot;last updated&quot; date above. Continued use after a change means you accept the updated Terms.</p>

      <h2>9. Contact</h2>
      <p>Questions about these Terms? Reach us at <a href="mailto:hello@bando.app">hello@bando.app</a>.</p>
    </InfoPage>
  );
}
