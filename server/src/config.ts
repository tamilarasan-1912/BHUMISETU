import 'dotenv/config';

function req(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  env: req('NODE_ENV', 'development'),
  isProd,
  port: Number(req('PORT', '12001')),
  webOrigin: req('WEB_ORIGIN', '*'),

  databaseUrl: req(
    'DATABASE_URL',
    'postgres://bhumisetu:bhumisetu_dev_pw@127.0.0.1:5432/bhumisetu',
  ),

  // Secrets are never hard-coded in production. A dev fallback is generated
  // per-boot so local sessions are invalidated on restart rather than shipping
  // a predictable signing key.
  jwtSecret: req(
    'JWT_SECRET',
    isProd ? '' : `bhumisetu-dev-${Math.random().toString(36).slice(2)}`,
  ),
  jwtExpirySeconds: Number(req('JWT_EXPIRY_SECONDS', String(60 * 60 * 12))),

  // Optional external credentials - all adapters degrade gracefully when unset.
  copernicusClientId: process.env.COPERNICUS_CLIENT_ID || '',
  copernicusClientSecret: process.env.COPERNICUS_CLIENT_SECRET || '',
  copernicusTokenUrl: req(
    'COPERNICUS_TOKEN_URL',
    'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
  ),
  dataGovApiKey: process.env.DATA_GOV_IN_API_KEY || '',
  otherSourceApiKey: process.env.OTHER_SOURCE_API_KEY || '',

  bhuvanWmsUrl: req('BHUVAN_WMS_URL', 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms'),
  overpassUrl: req('OVERPASS_URL', 'https://overpass.kumi.systems/api/interpreter'),
  tngisBaseUrl: req('TNGIS_BASE_URL', 'https://tngis.tn.gov.in/'),
  surveyOfIndiaUrl: req(
    'SURVEY_OF_INDIA_URL',
    'https://onlinemaps.surveyofindia.gov.in/',
  ),

  adapterTimeoutMs: Number(req('ADAPTER_TIMEOUT_MS', '8000')),
  adapterRetries: Number(req('ADAPTER_RETRIES', '2')),
  adapterCacheTtlMs: Number(req('ADAPTER_CACHE_TTL_MS', '600000')),
  // How long a probed adapter status stays authoritative before a background
  // refresh. Reads never block on an unreachable upstream.
  adapterHealthTtlMs: Number(req('ADAPTER_HEALTH_TTL_MS', '120000')),
  // Hard ceiling for a synchronous health report.
  healthBudgetMs: Number(req('HEALTH_BUDGET_MS', '2000')),
  overpassRadiusLimitM: Number(req('OVERPASS_RADIUS_LIMIT_M', '1500')),

  // Optional AI provider. Core functionality never depends on this.
  aiProvider: process.env.AI_PROVIDER || '',
  aiApiKey: process.env.AI_API_KEY || '',
  aiModel: process.env.AI_MODEL || '',

  appVersion: '1.0.0',
  dataMode: 'MIXED' as const,
};

export function assertConfig(): void {
  if (config.isProd && !config.jwtSecret) {
    throw new Error('JWT_SECRET must be set in production');
  }
}

export type AppConfig = typeof config;
