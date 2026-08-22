import type { AppConfig } from "../config";

/**
 * Security headers applied to every response: CSP (default-src 'self'),
 * MIME sniffing protection, referrer policy, and clickjacking protection.
 */
export function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": "default-src 'self'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
  };
}

export function corsOptions(config: AppConfig) {
  return {
    origin: config.corsOrigin,
    credentials: false,
    allowedHeaders: ["Content-Type", "X-Job-Token"],
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  };
}
