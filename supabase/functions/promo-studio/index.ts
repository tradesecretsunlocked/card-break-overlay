// TSU Promo Studio - AI generator for high-CTR Whatnot stream titles, per-platform
// promo copy, a posting plan, and (Phase 2) the AI background art for the thumbnail.
// Auth: requires a logged-in JWT (verify_jwt true). Provider: OpenAI (OPENAI_API_KEY).
//
// Two modes on the same endpoint:
//   mode:"copy"  (default) -> titles + captions + plan + a thumbnail CONCEPT. Text only.
//   mode:"image"           -> gpt-image renders the BACKGROUND ART for that concept and
//                             uploads it to the promo-thumbnails bucket. Deliberately
//                             renders NO text: the browser canvas layers the headline and
//                             the real client logo on top, so type is always sharp and
//                             correctly spelled and the brand hex is exact.
//
// Phase 2 notes (2026-08-28):
//  - Image model is env-swappable (PROMO_IMAGE_MODEL). gpt-image-1.5 and gpt-image-2
//    require one-time API Organization Verification on the OpenAI account or they 403.
//    If that bites, set PROMO_IMAGE_MODEL=gpt-image-1 and no redeploy is needed.
//  - Every image is logged to public.promo_generations, which powers a per-seller daily
//    cap (PROMO_IMAGE_DAILY_CAP, default 15) so one power user cannot run up the bill.

import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MODEL = Deno.env.get("PROMO_MODEL") || "gpt-4o-mini";
const IMAGE_MODEL = Deno.env.get("PROMO_IMAGE_MODEL") || "gpt-image-1.5";
const IMAGE_QUALITY = Deno.env.get("PROMO_IMAGE_QUALITY") || "high";
const IMAGE_SIZE = Deno.env.get("PROMO_IMAGE_SIZE") || "1024x1536"; // vertical, Whatnot is mobile
const DAILY_CAP = Number(Deno.env.get("PROMO_IMAGE_DAILY_CAP") || "15");

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "promo-thumbnails";

// Rough per-image USD at portrait/high. Estimate only, for the spend log.
const COST: Record<string, number> = {
  "gpt-image-2": 0.30,
  "gpt-image-1.5": 0.20,
  "gpt-image-1": 0.25,
  "gpt-image-1-mini": 0.055,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM = `You are TSU Promo Studio, an expert live-selling promo strategist for Whatnot (and cross-platform) sellers. You use the Trade Secrets Unlocked "50 High-Converting Titles" methodology. Follow it exactly.

TITLE STRUCTURE (always): [Attention Grabber] + [Product/Category] + [Value Proposition] + [Urgency/FOMO].
Example: "$1 STARTS - MTG Collector Packs Madness! - Tonight Only!"
Use the AIDA model (Attention, Interest, Desire, Action) and remember buyers decide in ~3 seconds while scrolling on mobile.

POWER WORDS to draw from:
- Urgency: NOW, TONIGHT, LAST CHANCE, FINAL, ENDING SOON, LIMITED, EXCLUSIVE, RARE, ONLY X LEFT, FLASH.
- Value: FREE, BONUS, EXTRA, DOUBLE, HUGE, MASSIVE, INSANE, EPIC, GUARANTEED, VIP.
- Emotion: FIRE, LIT, WILD, EPIC, SHOCKING, UNBELIEVABLE, MUST-SEE, CAN'T MISS, LEGENDARY.

FORMULA CATEGORIES to vary across the 3 titles: Urgency/Scarcity, Value/Deal, Excitement/Hype, Exclusive/VIP, Giveaway/Bonus, Mystery/Surprise, Competitive/Auction, Seasonal/Themed. Give the 3 titles DIFFERENT angles, not 3 rewordings of one.

WHATNOT RULES: front-load the category and key terms; use platform-recognized words (Auction, BIN, Giveaway, Breaks, $1 Start); 1-2 emojis max, tastefully; keep it punchy and mobile-readable; do not keyword-stuff.

THUMBNAIL CONCEPT: describe a scroll-stopping thumbnail using the TSU thumbnail hierarchy - (1) contrast/color first, (2) big readable text in the UPPER 2/3 (bottom is covered by UI), (3) one clear focal point (the best item), (4) an emotional or value/scarcity cue. Whatnot thumbnails are VERTICAL/mobile. Color psychology: red=urgency, yellow/orange=attention, blue=trust, green=savings, purple=premium.

ART DIRECTION (separate field, "artDirection"): describe ONLY the photographic/illustrated BACKGROUND SCENE for that thumbnail, with NO text and NO logo in it, because the headline type and the seller's logo get layered on afterwards. Name the hero subject, the camera angle, the lighting, the depth of field, and the mood. Keep the composition's top third visually calm and darker so a headline will sit legibly over it, and put the hero subject in the middle band. 2-3 sentences, concrete and visual.

CROSS-PLATFORM COPY: adapt tone per platform. Instagram = polished + save-worthy + 4-6 hashtags. TikTok = short, punchy, high energy, hook-first, heavier emoji. YouTube Community = clear value + a reminder-to-set. Facebook = friendly + community. X/Twitter = terse hype. Always include the show date/time and a clear CTA to join.

POSTING PLAN: build a realistic teaser -> day-of -> ~1 hour out -> live sequence across the seller's selected platforms.

RESPOND WITH STRICT JSON ONLY, this exact shape:
{
  "titles": ["...", "...", "..."],
  "titleNotes": "one short line naming the formula angle used for each of the 3",
  "thumbnailConcept": "2-4 sentences describing the thumbnail to make",
  "artDirection": "2-3 sentences describing ONLY the background scene, no text, no logo",
  "headline": "3-5 WORDS MAX, the words to overlay on the thumbnail, ALL CAPS",
  "promoSummary": "1-2 punchy sentences hyping the show",
  "platformPosts": { "<platform>": "ready-to-post caption incl. date/time + CTA" },
  "postingPlan": [ { "when": "Night before", "channel": "Instagram", "action": "..." } ]
}
Only include platforms the user selected in platformPosts and the plan. No markdown, no commentary outside the JSON.`;

/* ---------------- image prompt ---------------- */

function artPrompt(o: {
  art: string; product: string; vibe: string; format: string;
  primary: string; secondary: string;
}) {
  const palette = (o.primary || o.secondary)
    ? `Dominant palette: ${o.primary ? `primary ${o.primary}` : ""}${o.primary && o.secondary ? ", " : ""}${o.secondary ? `secondary ${o.secondary}` : ""}. Build real light/dark contrast against those colors, never a flat single-color image.`
    : `Build a high-contrast palette with a clear dominant color and a complementary accent. Never flat or single-color.`;

  return `Vertical 2:3 mobile thumbnail BACKGROUND ART for a live sports-card / collectibles selling show.

SCENE: ${o.art || `A dramatic hero shot of ${o.product || "trading cards"}, ${o.format || "live break"} energy.`}

Subject matter: ${o.product || "trading cards and sealed product"}. Mood and energy: ${o.vibe || "high energy, premium, exciting"}.

${palette}

STYLE: premium sports-broadcast / esports key art. Dramatic directional studio lighting, glossy highlights, rich shadow depth, shallow depth of field on the hero subject, subtle energy effects (light streaks, embers, dust motes, bokeh) used deliberately and never muddy. Crisp, punchy, high production value. Use gradients deliberately to draw the eye to the hero subject.

COMPOSITION, THIS IS CRITICAL: the hero subject sits in the MIDDLE BAND of the vertical frame. The TOP THIRD must stay visually calm, darker, and uncluttered, a soft gradient or shallow-focus falloff, because a large headline will be placed over it. Keep the BOTTOM SIXTH simple as well, it gets covered by app UI.

ABSOLUTELY NO TEXT. Do not render any letters, words, numbers, captions, headlines, watermarks, signatures, logos, brand marks, price tags, or UI elements anywhere in the image. No people's faces in close-up. The image must be pure background artwork only. Any text in the output is a failure.`;
}

/* ---------------- handler ---------------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!OPENAI_KEY) return json({ error: "AI is not configured yet. Add OPENAI_API_KEY in Supabase edge secrets.", code: "no_key" }, 503);

  const b = await req.json().catch(() => ({} as any));
  const mode = String(b.mode || "copy");

  /* ============ MODE: IMAGE ============ */
  if (mode === "image") {
    const svc = createClient(SB_URL, SERVICE);
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SB_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Not authenticated" }, 401);

    // Daily cap, so one seller cannot run up the image bill.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await svc.from("promo_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", since);
    if ((count ?? 0) >= DAILY_CAP) {
      return json({
        error: `You've generated ${count} thumbnails in the last 24 hours, which is the current limit. Your copy and titles still work. Try again later or ask TSU to raise your limit.`,
        code: "rate_limited",
      }, 429);
    }

    const prompt = artPrompt({
      art: String(b.artDirection || b.concept || "").slice(0, 1200),
      product: String(b.product || "").slice(0, 200),
      vibe: String(b.vibe || "").slice(0, 80),
      format: String(b.format || "").slice(0, 60),
      primary: String(b.primary || "").slice(0, 20),
      secondary: String(b.secondary || "").slice(0, 20),
    });

    let resp: Response;
    try {
      resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: IMAGE_SIZE, quality: IMAGE_QUALITY, n: 1 }),
      });
    } catch (e) { return json({ error: "Could not reach the image provider.", detail: String(e) }, 502); }

    const data = await resp.json().catch(() => ({} as any));
    if (!resp.ok) {
      const msg = data?.error?.message || "Image provider error";
      if (resp.status === 403 || /verif/i.test(msg)) {
        return json({
          error: `The image model "${IMAGE_MODEL}" is not enabled on this OpenAI account. It needs one-time API Organization Verification at platform.openai.com under Settings, Organization. Until then set the edge secret PROMO_IMAGE_MODEL to gpt-image-1.`,
          code: "model_not_enabled", detail: msg,
        }, 502);
      }
      return json({ error: msg, code: "provider_error" }, 502);
    }

    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return json({ error: "The image provider returned no image. Try again." }, 502);

    let bytes: Uint8Array;
    try {
      const bin = atob(b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_) { return json({ error: "Could not decode the generated image." }, 502); }

    const path = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`;
    const { error: upErr } = await svc.storage.from(BUCKET)
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (upErr) return json({ error: `Could not save the image: ${upErr.message}` }, 500);

    const { data: pub } = svc.storage.from(BUCKET).getPublicUrl(path);
    const imageUrl = pub?.publicUrl ?? null;

    await svc.from("promo_generations").insert({
      user_id: user.id,
      bridge_key: b.bridge_key ? String(b.bridge_key).slice(0, 120) : null,
      model: IMAGE_MODEL, quality: IMAGE_QUALITY, size: IMAGE_SIZE,
      est_cost_usd: COST[IMAGE_MODEL] ?? 0.2,
      image_path: path, image_url: imageUrl, prompt,
    });

    return json({
      ok: true, imageUrl, path, model: IMAGE_MODEL,
      remainingToday: Math.max(0, DAILY_CAP - ((count ?? 0) + 1)),
    });
  }

  /* ============ MODE: COPY (default) ============ */
  const seller = String(b.seller || "").slice(0, 80);
  const product = String(b.product || "").slice(0, 200);
  const format = String(b.format || "").slice(0, 60);
  const deal = String(b.deal || "").slice(0, 120);
  const datetime = String(b.datetime || "").slice(0, 80);
  const vibe = String(b.vibe || "").slice(0, 80);
  const notes = String(b.notes || "").slice(0, 500);
  const platforms = Array.isArray(b.platforms) ? b.platforms.slice(0, 8).map((p: any) => String(p).slice(0, 30)) : [];
  if (!product) return json({ error: "Tell me what you're selling (product/category)." }, 400);

  const userMsg = `Create the promo package.\nSeller: ${seller || "(unspecified)"}\nProduct / category: ${product}\nFormat: ${format || "(unspecified)"}\nDeal / hook: ${deal || "(none given)"}\nShow date/time: ${datetime || "(unspecified)"}\nDesired vibe/tone: ${vibe || "(seller default)"}\nExtra notes: ${notes || "(none)"}\nPlatforms to write copy + plan for: ${platforms.length ? platforms.join(", ") : "Instagram, TikTok"}`;

  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.9,
        response_format: { type: "json_object" },
        messages: [ { role: "system", content: SYSTEM }, { role: "user", content: userMsg } ],
      }),
    });
  } catch (e) { return json({ error: "Could not reach the AI provider.", detail: String(e) }, 502); }

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return json({ error: data?.error?.message || "AI provider error", code: "provider_error" }, 502);
  let out: any;
  try { out = JSON.parse(data.choices?.[0]?.message?.content || "{}"); }
  catch (_) { return json({ error: "AI returned an unparseable response, try again." }, 502); }
  return json({ ok: true, result: out });
});
