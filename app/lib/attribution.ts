import type { AttributionMethod } from "./types.ts";

// Resolves a Shopify order to a Meta campaign / ad set / ad.
//
// Verified on real VegaLife orders: Meta ids travel in the UTMs as
//   utm_campaign (= utm_id) -> campaign id, utm_term -> ad set id, utm_content -> ad id.
// Sources, in priority order (last touch wins; first/last visit differ on ~1 in 10 orders):
//   1. order note attributes (checkout/COD-form capture)      -> method ID
//   2. Shopify customerJourneySummary lastVisit UTMs          -> method ID
//   3. Shopify customerJourneySummary firstVisit UTMs         -> method ID
//   4. landing URL query parameters (campaign_id / ad_id ...) -> method URL_PARSE
// Within a source, a missing id may be filled from that source's URL parameters (e.g. the
// Catalog Retargeting ads put a name in utm_content but carry the real ad_id in the URL).
// Names that cannot be resolved are returned in `unresolved` so the sync layer can try UtmNameMap.

export interface UtmSet {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  id?: string | null;
}

// A UTM set plus explicit id parameters that some URLs carry (campaign_id, adset_id, ad_id).
export interface ParsedParams extends UtmSet {
  campaignId?: string | null;
  adSetId?: string | null;
  adId?: string | null;
}

export interface AttributionInput {
  noteAttributes?: { key: string; value: string | null }[] | null;
  lastVisit?: UtmSet | null;
  firstVisit?: UtmSet | null;
  // Landing URLs, most relevant first (last visit, then first visit).
  landingUrls?: (string | null | undefined)[];
}

export interface Unresolved {
  field: "campaign" | "term" | "content";
  value: string;
}

export interface AttributionResult {
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
  method: AttributionMethod;
  unresolved: Unresolved[];
  rawUtm: UtmSet | null; // kept on the order for traceability (UTM fields only)
  landingUrl: string | null; // fbclid removed
}

// Meta ids are long numeric strings (15-18 digits). Anything else is a human name.
const META_ID = /^\d{12,}$/;

export function isMetaId(v: string | null | undefined): v is string {
  return typeof v === "string" && META_ID.test(v.trim());
}

function firstId(...values: (string | null | undefined)[]): string | null {
  for (const v of values) if (isMetaId(v)) return v.trim();
  return null;
}

export function parseUrlParams(url: string | null | undefined): ParsedParams | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url, "https://placeholder.invalid");
  } catch {
    return null;
  }
  const p = u.searchParams;
  const out: ParsedParams = {
    source: p.get("utm_source"),
    medium: p.get("utm_medium"),
    campaign: p.get("utm_campaign"),
    content: p.get("utm_content"),
    term: p.get("utm_term"),
    id: p.get("utm_id"),
    campaignId: p.get("campaign_id"),
    adSetId: p.get("adset_id"),
    adId: p.get("ad_id"),
  };
  const hasAny = Object.values(out).some((v) => v);
  return hasAny ? out : null;
}

export function stripTrackingNoise(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    u.searchParams.delete("fbclid");
    return u.toString();
  } catch {
    return url;
  }
}

function utmFromNoteAttributes(attrs: AttributionInput["noteAttributes"]): {
  utm: ParsedParams | null;
  fullUrl: string | null;
} {
  if (!attrs || attrs.length === 0) return { utm: null, fullUrl: null };
  const m = new Map<string, string>();
  for (const a of attrs) if (a.value != null) m.set(a.key.trim().toLowerCase(), a.value);
  const utm: ParsedParams = {
    source: m.get("utm_source") ?? null,
    medium: m.get("utm_medium") ?? null,
    campaign: m.get("utm_campaign") ?? null,
    content: m.get("utm_content") ?? null,
    term: m.get("utm_term") ?? null,
    id: m.get("utm_id") ?? null,
  };
  const hasAny = Object.values(utm).some((v) => v);
  return { utm: hasAny ? utm : null, fullUrl: m.get("full_url") ?? null };
}

interface Ids {
  campaignId: string | null;
  adSetId: string | null;
  adId: string | null;
}

function idsFrom(p: ParsedParams | null): Ids {
  if (!p) return { campaignId: null, adSetId: null, adId: null };
  return {
    campaignId: firstId(p.campaignId, p.id, p.campaign),
    adSetId: firstId(p.adSetId, p.term),
    adId: firstId(p.adId, p.content),
  };
}

const hasAnyId = (i: Ids) => Boolean(i.campaignId || i.adSetId || i.adId);

function unresolvedNames(p: ParsedParams | null, found: Ids): Unresolved[] {
  if (!p) return [];
  const out: Unresolved[] = [];
  const isName = (v: string | null | undefined): v is string => Boolean(v) && !isMetaId(v);
  if (!found.campaignId && isName(p.campaign)) out.push({ field: "campaign", value: p.campaign });
  if (!found.adSetId && isName(p.term)) out.push({ field: "term", value: p.term });
  if (!found.adId && isName(p.content)) out.push({ field: "content", value: p.content });
  return out;
}

function toUtmSet(p: ParsedParams | null): UtmSet | null {
  if (!p) return null;
  const s: UtmSet = {
    source: p.source ?? null,
    medium: p.medium ?? null,
    campaign: p.campaign ?? null,
    content: p.content ?? null,
    term: p.term ?? null,
    id: p.id ?? null,
  };
  return Object.values(s).some((v) => v) ? s : null;
}

interface Candidate {
  utm: ParsedParams | null; // structured UTMs for this source
  url: ParsedParams | null; // parameters parsed from this source's URL
}

export function resolveAttribution(input: AttributionInput): AttributionResult {
  const note = utmFromNoteAttributes(input.noteAttributes);
  const urls = input.landingUrls ?? [];
  const landingUrl = stripTrackingNoise(note.fullUrl ?? urls.find(Boolean) ?? null);

  const candidates: Candidate[] = [
    { utm: note.utm, url: parseUrlParams(note.fullUrl) },
    { utm: input.lastVisit ?? null, url: parseUrlParams(urls[0]) },
    { utm: input.firstVisit ?? null, url: parseUrlParams(urls[1] ?? urls[0]) },
    { utm: null, url: parseUrlParams(urls.find(Boolean)) },
  ];

  let firstUnresolved: Unresolved[] = [];
  let rawUtm: UtmSet | null = null;

  for (const c of candidates) {
    if (!rawUtm) rawUtm = toUtmSet(c.utm) ?? toUtmSet(c.url);
    const fromUtm = idsFrom(c.utm);
    const fromUrl = idsFrom(c.url);

    if (hasAnyId(fromUtm)) {
      return {
        campaignId: fromUtm.campaignId ?? fromUrl.campaignId,
        adSetId: fromUtm.adSetId ?? fromUrl.adSetId,
        adId: fromUtm.adId ?? fromUrl.adId,
        method: "ID",
        unresolved: unresolvedNames(c.utm, {
          campaignId: fromUtm.campaignId ?? fromUrl.campaignId,
          adSetId: fromUtm.adSetId ?? fromUrl.adSetId,
          adId: fromUtm.adId ?? fromUrl.adId,
        }),
        rawUtm: toUtmSet(c.utm),
        landingUrl,
      };
    }
    if (hasAnyId(fromUrl)) {
      return {
        ...fromUrl,
        method: "URL_PARSE",
        unresolved: unresolvedNames(c.url, fromUrl),
        rawUtm: toUtmSet(c.url),
        landingUrl,
      };
    }
    if (firstUnresolved.length === 0) {
      firstUnresolved = [...unresolvedNames(c.utm, fromUtm), ...unresolvedNames(c.url, fromUrl)];
    }
  }

  return {
    campaignId: null,
    adSetId: null,
    adId: null,
    method: "NONE",
    unresolved: firstUnresolved,
    rawUtm,
    landingUrl,
  };
}
