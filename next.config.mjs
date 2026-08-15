import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Глобальные security-заголовки (BRIEF §6.1 defense-in-depth). Применяются на уровне
  // роутинга ДО хендлеров/страниц (см. resolve-routes.js в next/dist), поэтому там, где
  // конкретный роут сам ставит те же заголовки на свой Response (runner/route.ts —
  // X-Frame-Options/CSP для sandboxed iframe), его значение накатывается позже через
  // res.setHeader и побеждает — конфликта нет. Полный CSP тут намеренно не задаём: слишком
  // рискованно для существующих страниц без аудита инлайн-скриптов/стилей (вне скоупа).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // self, не none — Speaking Lab пишет аудио через MediaRecorder на same-origin странице.
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
          // SAMEORIGIN, не DENY — экзам-раннер (app/app/exam/[id]/runner/route.ts) отдаётся
          // в same-origin iframe и сам переустанавливает этот заголовок на своём Response.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

// Sentry оборачивает конфиг (BRIEF §11 — error-monitoring). org/project/authToken
// нужны ТОЛЬКО для загрузки source-map — откладываем до активации, поэтому
// sourcemaps.disable:true (build детерминированный, без обращения к Sentry).
// Ошибки ловятся и без карт (стектрейсы минифицированы). Без DSN весь рантайм
// Sentry — no-op.
export default withSentryConfig(nextConfig, {
  silent: !process.env.CI,
  sourcemaps: { disable: true },
});
