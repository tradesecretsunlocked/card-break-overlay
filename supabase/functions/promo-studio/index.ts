// TSU Promo Studio - AI generator for high-CTR Whatnot stream titles, per-platform
// promo copy, a posting plan, and the thumbnail art.
// Auth: requires a logged-in JWT (verify_jwt true). Provider: OpenAI (OPENAI_API_KEY).
//
// Modes on the same endpoint:
//   mode:"copy"  (default) -> titles + captions + plan + thumbnail concept. Text only.
//   mode:"image"           -> gpt-image-2 renders the thumbnail, uploaded to promo-thumbnails.
//                             full:true  -> model renders the headline type too
//                             full:false -> background art only, browser canvas letters it
//
// v11 (2026-10-20): Mike's rulings. gpt-image-2 is the ONLY image model.
//   The per-request model override is gone. gpt-image-1.5 is used ONLY as an error fallback
//   (provider error or 403). Cap is now MONTHLY (PROMO_IMAGE_MONTHLY_CAP, default 40,
//   calendar month UTC) instead of 15 per 24h. Only the successful render is logged.
//   Response keeps remainingToday for the old page and adds remainingThisMonth.
//
// v10 (2026-09-12): per-request image model override (REMOVED in v11).
// v9: STYLE ANCHORS from the promo-anchors bucket via /v1/images/edits.
// v8: Titles are IMPROVISED; output is de-dashed; Whatnot's own Live pill is never drawn.

import { createClient } from "jsr:@supabase/supabase-js@2";

const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const MODEL = Deno.env.get("PROMO_MODEL") || "gpt-4o-mini";
const IMAGE_MODEL = "gpt-image-2";            // fixed by ruling, not env-swappable
const FALLBACK_IMAGE_MODEL = "gpt-image-1.5"; // used only if the primary errors
const IMAGE_QUALITY = Deno.env.get("PROMO_IMAGE_QUALITY") || "high";
const IMAGE_SIZE = Deno.env.get("PROMO_IMAGE_SIZE") || "1024x1536"; // vertical, Whatnot is mobile
const MONTHLY_CAP = Number(Deno.env.get("PROMO_IMAGE_MONTHLY_CAP") || "40");
const ANCHOR_URLS = (Deno.env.get("PROMO_ANCHOR_URLS") || "").split(",").map(s => s.trim()).filter(Boolean);
const ANCHOR_MAX = Number(Deno.env.get("PROMO_ANCHOR_MAX") || "8");

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "promo-thumbnails";
const ANCHOR_BUCKET = "promo-anchors";

// Rough per-image USD at portrait/high. Estimate only, for the spend log.
const COST: Record<string, number> = {
  "gpt-image-2": 0.30,
  "gpt-image-1.5": 0.20,
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const SYSTEM = `You are TSU Promo Studio, an expert live-selling promo strategist for Whatnot sellers, working in the Trade Secrets Unlocked house style.

HOW TO WRITE TITLES: improvise. Never fill in a template, never reuse an example title you have seen anywhere, and never copy an example's punctuation pattern. Formula lists and swipe files teach HOW a title is built. They are not scripts to run.

A strong Whatnot title, in priority order:
1. Front-loads the category and the actual product, so a scrolling buyer understands it in under 3 seconds on a phone.
2. Carries ONE clear reason to click right now: a price hook, a scarcity clock, a guarantee, a giveaway, or a genuinely unusual item.
3. Sounds like THIS seller. Match the brand name they gave and the vibe they asked for.

Give the 3 titles 3 genuinely different angles, for example urgency, value, and spectacle. Three rewordings of one idea is a failure.

CATEGORY VOICE: use the real working vocabulary of what is actually being sold, and never borrow a term from the wrong category.
- Sports card breaks: break, case, hobby box, PYT, random team, filler, slab, PSA, on-card auto, numbered, rookie patch.
- Pokemon and TCG: ETB, booster box, rip, alt art, hit, sealed, Japanese, graded.
- Funko and collectibles: chase, grail, vaulted, exclusive.
- Pallets and liquidation: manifest, untested, shelf pull, lot.

POWER WORD PALETTE, draw from it, do not work through it as a checklist:
- Urgency: NOW, TONIGHT, LAST CHANCE, FINAL, ENDING SOON, LIMITED, ONLY X LEFT, FLASH.
- Value: FREE, BONUS, DOUBLE, HUGE, MASSIVE, GUARANTEED, VIP, NO RESERVE.
- Emotion: FIRE, WILD, EPIC, INSANE, MUST SEE, LEGENDARY.

PUNCTUATION, HARD RULE: never use an em dash or an en dash in anything you write. Separate ideas with commas, colons, periods, exclamation marks, or the pipe character. This is a TSU house rule and it applies to titles, captions, the headline and every other field.

WHATNOT CONVENTIONS: use platform-recognized words where they genuinely apply (Auction, BIN, Giveaway, Breaks, $1 Start). 1 to 2 emoji maximum, tastefully. Punchy and mobile-readable. Do not keyword-stuff.

THUMBNAIL CONCEPT: describe a scroll-stopping thumbnail using the TSU thumbnail hierarchy: (1) contrast and color first, (2) text readable at small size, (3) one clear focal point, the best item, (4) an emotional or value/scarcity cue. Whatnot thumbnails are VERTICAL 9:16 and the browse feed crops them to about 3:4, so everything that matters belongs in the vertical middle, never the top or bottom eighth. Whatnot also draws its own live badge over the TOP LEFT corner, so keep that corner clear. Color psychology: red=urgency, yellow/orange=attention, blue=trust, green=savings, purple=premium.

ART DIRECTION (field "artDirection"): describe ONLY the background scene and the product collage, with NO text and NO logo in it. Name the products on show, how they are layered, the lighting, and the mood. 2 to 3 sentences, concrete and visual.

HEADLINE (field "headline"): the words that go ON the thumbnail. 3 to 5 words maximum, ALL CAPS, no dashes.

CROSS-PLATFORM COPY: adapt tone per platform. Instagram = polished, save-worthy, 4 to 6 hashtags. TikTok = short, punchy, hook first, heavier emoji. YouTube Community = clear value plus a reminder-to-set. Facebook = friendly and community-minded. X/Twitter = terse hype. Always include the show date and time and a clear CTA to join.

POSTING PLAN: a realistic teaser, then day-of, then about an hour out, then live, across the platforms the seller selected.

RESPOND WITH STRICT JSON ONLY, this exact shape:
{
  "titles": ["...", "...", "..."],
  "titleNotes": "one short line naming the angle used for each of the 3",
  "thumbnailConcept": "2-4 sentences describing the thumbnail to make",
  "artDirection": "2-3 sentences describing ONLY the background scene and product collage, no text, no logo",
  "headline": "3-5 WORDS MAX, ALL CAPS",
  "promoSummary": "1-2 punchy sentences hyping the show",
  "platformPosts": { "<platform>": "ready-to-post caption incl. date/time + CTA" },
  "postingPlan": [ { "when": "Night before", "channel": "Instagram", "action": "..." } ]
}
Only include platforms the user selected in platformPosts and the plan. No markdown, no commentary outside the JSON.`;

/* ---------------- style anchors ---------------- */

async function anchorUrls(svc: any): Promise<string[]> {
  if (ANCHOR_URLS.length) return ANCHOR_URLS.slice(0, ANCHOR_MAX);
  try {
    const { data } = await svc.storage.from(ANCHOR_BUCKET)
      .list("", { limit: 50, sortBy: { column: "name", order: "asc" } });
    return (data ?? [])
      .filter((f: any) => /\.(png|jpe?g|webp)$/i.test(f.name))
      .slice(0, ANCHOR_MAX)
      .map((f: any) => svc.storage.from(ANCHOR_BUCKET).getPublicUrl(f.name).data.publicUrl);
  } catch (_) { return []; }
}

async function fetchAnchors(urls: string[]) {
  const out: { blob: Blob; name: string }[] = [];
  await Promise.all(urls.map(async (u) => {
    try {
      const r = await fetch(u);
      if (!r.ok) return;
      const blob = await r.blob();
      if (blob.size > 0) out.push({ blob, name: u.split("/").pop() || "anchor.jpg" });
    } catch (_) { /* a missing anchor must never fail the generation */ }
  }));
  return out;
}

/* ---------------- image prompt ---------------- */

function artPrompt(o: {
  art: string; product: string; vibe: string; format: string;
  primary: string; secondary: string; headline: string; deal: string;
  seller: string; full: boolean; anchored: boolean;
}) {
  const palette = (o.primary || o.secondary)
    ? `Dominant palette: ${o.primary ? `primary ${o.primary}` : ""}${o.primary && o.secondary ? ", " : ""}${o.secondary ? `secondary ${o.secondary}` : ""}. Build real light/dark contrast, never a flat single-color image.`
    : `High-contrast palette with one dominant color and a punchy complementary accent. Never flat or single-color.`;

  const anchorRule = o.anchored ? `

REFERENCE IMAGES: the attached images are approved examples of the house style. Copy ONLY their visual language: the layered collage construction, the density and energy, the typography treatment, the colour contrast, and where elements sit in the frame.

Do NOT copy anything specific from them. Not their products, not their text or wording, not their logos or brand marks, not the people in them, and not any trademarked character art, card art or packaging that appears in them. Invent fresh product imagery appropriate to THIS seller's category. Treat the references as a mood board, never as source material to reproduce.` : "";

  const base = `A vertical 9:16 mobile thumbnail for a LIVE sports-card and collectibles selling show on Whatnot. Loud, cluttered-in-a-good-way, stops a thumb scrolling at speed.

STRUCTURE, follow this closely. This is a LAYERED COLLAGE, not a single cinematic photograph:
- Multiple cut-out product images at different depths and angles, overlapping each other: sealed boxes, booster packs, and graded slabbed cards fanned across the frame. Drop shadows and glows separate the layers.
- An energetic graphic background BEHIND the products: lightning, embers, explosive light bursts, cosmic haze or speed rays in the brand colors. Busy at the edges, calmer directly behind the type.
- Deliberate gradients that pull the eye to the centre of the frame.

SUBJECT: ${o.product || "trading cards and sealed product"}. Show format: ${o.format || "live break"}. Energy: ${o.vibe || "high energy, premium, hyped"}.

${palette}${anchorRule}

COMPOSITION, CRITICAL: this art gets cropped to about 3:4 in the browse feed, so the TOP EIGHTH and BOTTOM EIGHTH will be cut off. Every important element must sit inside the vertical middle. Keep the extreme top and bottom edges as background only.

NO APP UI: do not render a live badge, a viewer count, a play button, a platform watermark, or any app interface element. Whatnot draws its own live badge over the TOP LEFT corner of the finished thumbnail, so leave that corner free of anything important.`;

  if (!o.full) {
    return base + `

ABSOLUTELY NO TEXT. Do not render letters, words, numbers, captions, headlines, watermarks, signatures, logos, brand marks or price tags anywhere, including any text visible in the reference images. The headline type and the seller's logo are composited on top afterwards, so leave clean space for them across the vertical middle. Any text in the output is a failure.`;
  }

  return base + `

TYPOGRAPHY, render this text into the image, spelled EXACTLY as given:
- Main headline: "${(o.headline || "").toUpperCase()}"
${o.deal ? `- Secondary flash line: "${o.deal.toUpperCase()}"\n` : ""}${o.seller ? `- Small seller name near the bottom: "${o.seller.toUpperCase()}"\n` : ""}
Type treatment: huge bold condensed display lettering, stacked on two or three lines, filled with a metallic gold or chrome gradient, wrapped in a thick contrasting outline plus a second outer stroke, with a hard drop shadow and a soft outer glow. Sticker or comic-burst styling. The headline is the loudest element in the frame and must be readable at thumbnail size on a phone. Place it across the vertical middle. Spell every word exactly as written above, no invented words, no gibberish letterforms, and no dashes of any kind.

Render ONLY the text listed above. Do not reproduce any wording from the reference images. No watermarks, no signatures, no fake brand logos, no invented copyright marks.`;
}

/* ---------------- one render attempt ---------------- */

async function renderOnce(model: string, prompt: string, anchors: { blob: Blob; name: string }[]) {
  try {
    let resp: Response;
    if (anchors.length) {
      const fd = new FormData();
      fd.append("model", model);
      fd.append("prompt", prompt);
      fd.append("size", IMAGE_SIZE);
      fd.append("quality", IMAGE_QUALITY);
      fd.append("n", "1");
      for (const a of anchors) fd.append("image[]", a.blob, a.name);
      resp = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_KEY}` }, // no Content-Type, fetch sets the boundary
        body: fd,
      });
    } else {
      resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, size: IMAGE_SIZE, quality: IMAGE_QUALITY, n: 1 }),
      });
    }
    const data = await resp.json().catch(() => ({} as any));
    const b64 = data?.data?.[0]?.b64_json;
    if (resp.ok && b64) return { ok: true as const, b64 };
    return { ok: false as const, status: resp.status, msg: data?.error?.message || "Image provider error" };
  } catch (e) {
    return { ok: false as const, status: 0, msg: `Could not reach the image provider: ${String(e)}` };
  }
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

    // Monthly cap (calendar month, UTC), so one seller cannot run up the image bill.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const { count } = await svc.from("promo_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id).gte("created_at", monthStart);
    if ((count ?? 0) >= MONTHLY_CAP) {
      return json({
        error: `You've generated ${count} thumbnails this month, which is the current monthly limit of ${MONTHLY_CAP}. Your copy and titles still work. The limit resets on the 1st, or ask TSU about a top-up pack.`,
        code: "rate_limited",
      }, 429);
    }

    const wantAnchors = b.anchors !== false;
    const anchors = wantAnchors ? await fetchAnchors(await anchorUrls(svc)) : [];

    const prompt = artPrompt({
      art: String(b.artDirection || b.concept || "").slice(0, 1200),
      product: String(b.product || "").slice(0, 200),
      vibe: String(b.vibe || "").slice(0, 80),
      format: String(b.format || "").slice(0, 60),
      primary: String(b.primary || "").slice(0, 20),
      secondary: String(b.secondary || "").slice(0, 20),
      headline: String(b.headline || "").slice(0, 60),
      deal: String(b.deal || "").slice(0, 60),
      seller: String(b.seller || "").slice(0, 40),
      full: b.full === true,
      anchored: anchors.length > 0,
    });

    let imageModel = IMAGE_MODEL;
    let fellBack = false;
    let primaryError = "";
    let r = await renderOnce(IMAGE_MODEL, prompt, anchors);
    if (!r.ok) {
      primaryError = `${r.status}: ${r.msg}`;
      console.error("promo-studio primary model failed, falling back", primaryError);
      imageModel = FALLBACK_IMAGE_MODEL;
      fellBack = true;
      r = await renderOnce(FALLBACK_IMAGE_MODEL, prompt, anchors);
    }
    if (!r.ok) {
      return json({
        error: r.msg, code: "provider_error", model: imageModel, anchorsUsed: anchors.length,
        primaryError, fellBack,
      }, 502);
    }

    let bytes: Uint8Array;
    try {
      const bin = atob(r.b64);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (_) { return json({ error: "Could not decode the generated image." }, 502); }

    const path = `${user.id}/${Date.now()}-${imageModel}-${crypto.randomUUID().slice(0, 6)}.png`;
    const { error: upErr } = await svc.storage.from(BUCKET)
      .upload(path, bytes, { contentType: "image/png", upsert: false });
    if (upErr) return json({ error: `Could not save the image: ${upErr.message}` }, 500);

    const { data: pub } = svc.storage.from(BUCKET).getPublicUrl(path);
    const imageUrl = pub?.publicUrl ?? null;

    await svc.from("promo_generations").insert({
      user_id: user.id,
      bridge_key: b.bridge_key ? String(b.bridge_key).slice(0, 120) : null,
      model: imageModel, quality: IMAGE_QUALITY, size: IMAGE_SIZE,
      est_cost_usd: COST[imageModel] ?? 0.3,
      image_path: path, image_url: imageUrl, prompt,
    });

    const remaining = Math.max(0, MONTHLY_CAP - ((count ?? 0) + 1));
    return json({
      ok: true, imageUrl, path, model: imageModel, full: b.full === true,
      fellBack, anchorsUsed: anchors.length,
      endpoint: anchors.length ? "edits" : "generations",
      remainingThisMonth: remaining,
      remainingToday: remaining, // legacy field the v10 page reads
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

  const userMsg = `Create the promo package.\nSeller: ${seller || "(unspecified)"}\nProduct / category: ${product}\nFormat: ${format || "(unspecified)"}\nDeal / hook: ${deal || "(none given)"}\nShow date/time: ${datetime || "(unspecified)"}\nDesired vibe/tone: ${vibe || "(seller default)"}\nExtra notes: ${notes || "(none)"}\nPlatforms to write copy + plan for: ${platforms.length ? platforms.join(", ") : "Instagram, TikTok"}\n\nWrite fresh, improvised titles for THIS seller and THIS category. Do not reuse any example title.`;

  let resp: Response;
  try {
    resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.95,
        presence_penalty: 0.4,
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

  // Belt and braces on the TSU no-dash house rule.
  const deDash = (v: any): any =>
    typeof v === "string" ? v.replace(/\s*[–—]\s*/g, ", ")
    : Array.isArray(v) ? v.map(deDash)
    : (v && typeof v === "object") ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deDash(x)]))
    : v;

  return json({ ok: true, result: deDash(out) });
});
