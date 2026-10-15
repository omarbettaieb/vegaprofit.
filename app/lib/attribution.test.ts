import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMetaId, parseUrlParams, resolveAttribution, stripTrackingNoise } from "./attribution.ts";

// Ids below are real VegaLife campaign/ad-set/ad ids (not personal data); the shapes mirror
// real orders: COD-form note attributes, Shopify journey UTMs, and the name-in-utm_content case.
const MARINE = { campaign: "120248559200620179", term: "120248559200590179", ad: "120248559546940179" };
const CZINC = { campaign: "120248679772460179", term: "120248679772480179", ad: "120248679772470179" };
const OMEGA = { campaign: "120248539473670179", term: "120248539473680179", ad: "120248539523400179" };

describe("isMetaId", () => {
  it("accepts long numeric ids, rejects names", () => {
    assert.equal(isMetaId("120248559200620179"), true);
    assert.equal(isMetaId("Facebook_UA"), false);
    assert.equal(isMetaId("12345"), false);
    assert.equal(isMetaId(null), false);
  });
});

describe("resolveAttribution", () => {
  it("note attributes with ids => ID (COD-form order, journey empty)", () => {
    const r = resolveAttribution({
      noteAttributes: [
        { key: "utm_source", value: "facebook" },
        { key: "utm_medium", value: "paid" },
        { key: "utm_id", value: CZINC.campaign },
        { key: "utm_campaign", value: CZINC.campaign },
        { key: "utm_term", value: CZINC.term },
        { key: "utm_content", value: CZINC.ad },
        { key: "Nom", value: "Test Person" },
      ],
      lastVisit: null,
      firstVisit: null,
    });
    assert.equal(r.method, "ID");
    assert.equal(r.campaignId, CZINC.campaign);
    assert.equal(r.adSetId, CZINC.term);
    assert.equal(r.adId, CZINC.ad);
    assert.deepEqual(r.unresolved, []);
    assert.equal(r.rawUtm?.source, "facebook");
  });

  it("journey UTMs => ID (standard checkout order)", () => {
    const r = resolveAttribution({
      lastVisit: {
        source: "facebook",
        medium: "paid",
        campaign: MARINE.campaign,
        term: MARINE.term,
        content: MARINE.ad,
      },
    });
    assert.equal(r.method, "ID");
    assert.equal(r.campaignId, MARINE.campaign);
    assert.equal(r.adId, MARINE.ad);
  });

  it("last visit wins over first visit (they differ on real orders)", () => {
    const r = resolveAttribution({
      firstVisit: { campaign: OMEGA.campaign, term: OMEGA.term, content: OMEGA.ad },
      lastVisit: { campaign: MARINE.campaign, term: MARINE.term, content: MARINE.ad },
    });
    assert.equal(r.campaignId, MARINE.campaign);
  });

  it("falls back to first visit when last visit has no UTMs", () => {
    const r = resolveAttribution({
      firstVisit: { campaign: OMEGA.campaign, term: OMEGA.term, content: OMEGA.ad },
      lastVisit: null,
    });
    assert.equal(r.campaignId, OMEGA.campaign);
    assert.equal(r.method, "ID");
  });

  it("note attributes beat journey UTMs", () => {
    const r = resolveAttribution({
      noteAttributes: [
        { key: "utm_campaign", value: CZINC.campaign },
        { key: "utm_term", value: CZINC.term },
        { key: "utm_content", value: CZINC.ad },
      ],
      lastVisit: { campaign: MARINE.campaign, term: MARINE.term, content: MARINE.ad },
    });
    assert.equal(r.campaignId, CZINC.campaign);
  });

  it("name in utm_content: ad id recovered from the landing URL ad_id", () => {
    const r = resolveAttribution({
      noteAttributes: [
        { key: "utm_campaign", value: "120248374949170179" },
        { key: "utm_term", value: "120248374949220179" },
        { key: "utm_content", value: "Facebook_UA" },
        {
          key: "full_url",
          value:
            "https://shop.example/products/x?utm_content=Facebook_UA&campaign_id=120248374949170179&ad_id=120248374949190179&fbclid=abc123&utm_term=120248374949220179",
        },
      ],
    });
    assert.equal(r.method, "ID");
    assert.equal(r.campaignId, "120248374949170179");
    assert.equal(r.adSetId, "120248374949220179");
    assert.equal(r.adId, "120248374949190179");
    assert.deepEqual(r.unresolved, []);
    assert.equal(r.landingUrl?.includes("fbclid"), false);
  });

  it("name in utm_content with no ad_id anywhere: ad stays null and the name is reported", () => {
    const r = resolveAttribution({
      lastVisit: {
        source: "facebook",
        medium: "paid",
        campaign: "120248374949170179",
        term: "120248374949220179",
        content: "Facebook_UA",
      },
    });
    assert.equal(r.campaignId, "120248374949170179");
    assert.equal(r.adId, null);
    assert.deepEqual(r.unresolved, [{ field: "content", value: "Facebook_UA" }]);
  });

  it("landing URL only => URL_PARSE", () => {
    const r = resolveAttribution({
      landingUrls: [
        "https://shop.example/products/x?utm_source=facebook&utm_medium=paid&campaign_id=120248438676300179&ad_id=120248438676310179",
      ],
    });
    assert.equal(r.method, "URL_PARSE");
    assert.equal(r.campaignId, "120248438676300179");
    assert.equal(r.adId, "120248438676310179");
    assert.equal(r.adSetId, null);
  });

  it("direct visit, no UTMs => NONE (unattributed)", () => {
    const r = resolveAttribution({
      lastVisit: null,
      firstVisit: null,
      landingUrls: ["https://shop.example/"],
    });
    assert.equal(r.method, "NONE");
    assert.equal(r.campaignId, null);
    assert.equal(r.adSetId, null);
    assert.equal(r.adId, null);
  });

  it("Instagram placement with facebook/paid UTMs is still attributed", () => {
    const r = resolveAttribution({
      lastVisit: { source: "facebook", medium: "paid", campaign: OMEGA.campaign, term: OMEGA.term, content: OMEGA.ad },
    });
    assert.equal(r.method, "ID");
  });

  it("handles missing everything", () => {
    const r = resolveAttribution({});
    assert.equal(r.method, "NONE");
    assert.equal(r.rawUtm, null);
    assert.equal(r.landingUrl, null);
  });
});

describe("url helpers", () => {
  it("parseUrlParams returns null when there is nothing useful", () => {
    assert.equal(parseUrlParams("https://shop.example/products/x"), null);
    assert.equal(parseUrlParams(null), null);
  });
  it("stripTrackingNoise removes fbclid only", () => {
    const out = stripTrackingNoise("https://shop.example/p?fbclid=zzz&utm_source=facebook");
    assert.equal(out, "https://shop.example/p?utm_source=facebook");
  });
});
