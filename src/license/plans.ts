/**
 * Pläne von Nodaris (Abschnitt 8.1) und Feature-Flags.
 * Der Free-Plan bleibt für Hobbyprojekte vollwertig – keine Pop-ups, nur dezente Hinweise.
 */
export type PlanId = 'free' | 'plus' | 'pro' | 'team' | 'enterprise';

export interface PlanFeatures {
  commercial: boolean;
  privateProjects: number; // Infinity = unbegrenzt
  emulators: boolean;
  piLinux: boolean;
  maxLayers: number;
  analyses: boolean;
  gerberLogo: boolean;
  advancedFab: boolean;
  aiPerMonth: number;
  cloudGB: number;
  collab: 'nein' | '2 Gäste' | 'ja';
  historyDays: number;
  reviews: boolean;
  api: boolean;
  sso: boolean;
  scim: boolean;
  auditLog: boolean;
  selfHosted: boolean;
  companyLibrary: boolean;
  support: string;
}

export interface Plan {
  id: PlanId;
  name: string;
  fuer: string;
  monat: number | null;
  jahr: number | null;
  proNutzer: boolean;
  features: PlanFeatures;
}

const INF = Number.POSITIVE_INFINITY;

export const PLANS: Plan[] = [
  {
    id: 'free', name: 'Nodaris Free', fuer: 'Einsteiger, Schüler', monat: 0, jahr: 0, proNutzer: false,
    features: { commercial: false, privateProjects: 3, emulators: false, piLinux: false, maxLayers: 2, analyses: false, gerberLogo: true, advancedFab: false, aiPerMonth: 10, cloudGB: 0.5, collab: 'nein', historyDays: 7, reviews: false, api: false, sso: false, scim: false, auditLog: false, selfHosted: false, companyLibrary: false, support: 'Community-Forum' },
  },
  {
    id: 'plus', name: 'Nodaris Plus', fuer: 'Bastler', monat: 6, jahr: 60, proNutzer: false,
    features: { commercial: false, privateProjects: INF, emulators: true, piLinux: true, maxLayers: 4, analyses: false, gerberLogo: false, advancedFab: false, aiPerMonth: 100, cloudGB: 10, collab: 'nein', historyDays: 30, reviews: false, api: false, sso: false, scim: false, auditLog: false, selfHosted: false, companyLibrary: false, support: 'E-Mail' },
  },
  {
    id: 'pro', name: 'Nodaris Pro', fuer: 'Selbstständige, Profis', monat: 19, jahr: 190, proNutzer: false,
    features: { commercial: true, privateProjects: INF, emulators: true, piLinux: true, maxLayers: 32, analyses: true, gerberLogo: false, advancedFab: true, aiPerMonth: 500, cloudGB: 50, collab: '2 Gäste', historyDays: INF, reviews: true, api: true, sso: false, scim: false, auditLog: false, selfHosted: false, companyLibrary: false, support: 'E-Mail (48 h)' },
  },
  {
    id: 'team', name: 'Nodaris Team', fuer: 'Firmen-Teams', monat: 49, jahr: 490, proNutzer: true,
    features: { commercial: true, privateProjects: INF, emulators: true, piLinux: true, maxLayers: 32, analyses: true, gerberLogo: false, advancedFab: true, aiPerMonth: 1000, cloudGB: 200, collab: 'ja', historyDays: INF, reviews: true, api: true, sso: true, scim: false, auditLog: false, selfHosted: false, companyLibrary: false, support: 'Priorität (24 h)' },
  },
  {
    id: 'enterprise', name: 'Nodaris Enterprise', fuer: 'Große Firmen', monat: null, jahr: null, proNutzer: true,
    features: { commercial: true, privateProjects: INF, emulators: true, piLinux: true, maxLayers: 32, analyses: true, gerberLogo: false, advancedFab: true, aiPerMonth: INF, cloudGB: INF, collab: 'ja', historyDays: INF, reviews: true, api: true, sso: true, scim: true, auditLog: true, selfHosted: true, companyLibrary: true, support: 'Persönlicher Ansprechpartner, SLA 99,9 %' },
  },
];

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id) ?? PLANS[0];

/** Zeilen der Vergleichstabelle */
export const FEATURE_ROWS: { key: keyof PlanFeatures; label: string }[] = [
  { key: 'commercial', label: 'Kommerzielle Nutzung' },
  { key: 'privateProjects', label: 'Private Projekte' },
  { key: 'emulators', label: 'Echte Emulatoren (Präzisionsmodus)' },
  { key: 'piLinux', label: 'Raspberry Pi mit Linux' },
  { key: 'maxLayers', label: 'Platinenlagen' },
  { key: 'analyses', label: 'Analysen (SI, Wärme, EMV, Monte Carlo)' },
  { key: 'advancedFab', label: 'ODB++, IPC-2581, Fertigungsdoku' },
  { key: 'aiPerMonth', label: 'KI-Anfragen pro Monat' },
  { key: 'cloudGB', label: 'Cloud-Speicher' },
  { key: 'collab', label: 'Echtzeit-Zusammenarbeit' },
  { key: 'historyDays', label: 'Versionsverlauf' },
  { key: 'api', label: 'CI / API / SDK' },
  { key: 'sso', label: 'Single Sign-On' },
  { key: 'auditLog', label: 'SCIM & Audit-Log' },
  { key: 'selfHosted', label: 'Self-Hosted / Offline-Lizenz' },
  { key: 'support', label: 'Support' },
];

export function formatFeature(key: keyof PlanFeatures, v: PlanFeatures[keyof PlanFeatures]): string {
  if (typeof v === 'boolean') return v ? '✓' : '—';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'unbegrenzt';
    if (key === 'cloudGB') return v < 1 ? `${v * 1000} MB` : `${v} GB`;
    if (key === 'historyDays') return `${v} Tage`;
    return v.toLocaleString('de-DE');
  }
  return String(v);
}
