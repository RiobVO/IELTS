import type { Metadata } from "next";
import { InfoPage } from "@/components/marketing/InfoPage";

export const metadata: Metadata = {
  title: "About — bando",
  description: "bando is the IELTS Reading & Listening trainer that shows you exactly which question types cost you points, then drills them.",
};

export default function AboutPage() {
  return (
    <InfoPage
      title="About bando"
      lead="The real exam tells you a band and walks away. bando shows you the exact question types costing you points — then drills them until they stop."
    >
      <h2>What bando is</h2>
      <p>
        bando is a focused IELTS trainer for the <strong>Reading</strong> and <strong>Listening</strong> papers. You sit
        complete, real-timed mock tests, and instead of a bare score you get a per-question-type breakdown: which
        formats you reliably get right, and which ones quietly drag your band down.
      </p>

      <h2>How it works</h2>
      <ul>
        <li><strong>Sit a full mock.</strong> 40 questions, real timing, no shortcuts.</li>
        <li><strong>See where you lose points.</strong> Your result is grouped by question type — matching headings, TFNG, completion, MCQ and the rest.</li>
        <li><strong>Drill the weak ones.</strong> Pick more tests that target the formats costing you the most.</li>
      </ul>

      <h2>Who it&apos;s for</h2>
      <p>
        Anyone preparing for academic or general IELTS who is tired of guessing why their band is stuck. Your first
        full test is free — no card required.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or feedback? Reach us at <a href="mailto:hello@bando.app">hello@bando.app</a>.
      </p>
    </InfoPage>
  );
}
