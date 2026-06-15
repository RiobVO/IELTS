import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
