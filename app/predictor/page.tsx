/**
 * Публичный Band Predictor (`/predictor`, G1-6) — верх воронки: десятиминутная
 * проба без регистрации, тизер результата гостю, полный разбор после signup.
 *
 * Гейтов доступа нет и не должно быть — это маркетинговая поверхность. Зато есть
 * два серверных инварианта: правильные ответы не покидают сервер (клиенту уходит
 * `PUBLIC_QUESTIONS`, где поля `accept` физически нет) и грейдинг живёт в server
 * action с IP-throttle.
 *
 * translate="no" — обязательный гейт для новой поверхности вне /app (готча про
 * Google Translate, ломающий React-реконсиляцию).
 */
import type { Metadata } from "next";
import { PUBLIC_QUESTIONS, PREDICTOR_PASSAGES } from "@/lib/predictor/bank";
import { getUser } from "@/lib/auth";
import { readPredictorSnapshot } from "./actions";
import PredictorScreen from "./PredictorScreen";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Free IELTS band predictor | bando",
  description:
    "Ten questions, about ten minutes: get an indicative IELTS Reading band range and the question type costing you the most marks. No sign-up to start.",
};

export default async function PredictorPage() {
  // Залогинен → показываем полный разбор сразу (он и есть награда за регистрацию);
  // гость видит тизер. Снимок живёт в cookie, поэтому переживает signup-круг.
  const [user, snapshot] = await Promise.all([getUser(), readPredictorSnapshot()]);

  return (
    <div translate="no" className="notranslate">
      <PredictorScreen
        questions={PUBLIC_QUESTIONS}
        passages={PREDICTOR_PASSAGES}
        initialSnapshot={snapshot}
        authed={!!user}
      />
    </div>
  );
}
