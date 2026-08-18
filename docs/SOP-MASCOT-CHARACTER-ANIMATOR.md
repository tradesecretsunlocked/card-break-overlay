# SOP — Pirate Mascot VTuber (Adobe Character Animator → OBS)

**Purpose:** Turn Wizard's Pirate Mascot PNG library into a live, face/voice-driven
on-camera avatar in Adobe Character Animator, and output it into OBS with a transparent
background so it drops inside the BTC neon facecam frame.

**Owner:** Mike / TSU
**Asset source:** `Pirate_Mascot_Transparent_PNG_Library_v1.0`
**Build artifact:** `WizardPirate_CharacterAnimator.psd` (staged in the `Pirate_Mascot` folder)
**Last updated:** 2026-07 (v1)

---

## 0. Read this first — what these assets are (and aren't)

Wizard's library is **80 full-body rendered PNG states** (2048×2048), not a layered rig.
Each pose/mouth/eye state is a **complete, independent render** — they are NOT pixel-registered
to each other (verified: even "Body Neutral" vs "Mouth Closed" differ across the whole figure).

**Consequence:** you cannot cleanly split these into separate mouth/eye/head *parts* over one
shared body — the seams won't line up. The correct, reliable way to use them in Character
Animator is a **swap set**: the whole frame swaps to match your speech (visemes), your blink,
your head angle, or a triggered pose. That is exactly what the provided PSD is built for.

What you get with this approach:
- **Automatic mic lip-sync** (mouth changes as you talk) ✓
- **Blink** (auto + tracked) ✓
- **Head turning** via Head Turner (front / left / right / up / down) ✓
- **Triggered expressions, poses, and sticker alerts** on hotkeys ✓

What this approach does NOT do (full-frame limitation):
- Smooth *deforming* head/body warp like a native Live2D rig. Head turns **snap** between the
  pre-drawn angle frames. Simultaneous head-turn + full visemes isn't available (the angle frames
  only carry closed/half/open mouths, not all 14 visemes).
- **Upgrade path if you ever want buttery deformation:** commission a *layered* character (one body
  with separate mouth/eye/brow layers on transparent backgrounds) and rig it in Live2D Cubism →
  VTube Studio. Different asset; not required for a great card-break stream.

---

## 1. The prebuilt PSD

`WizardPirate_CharacterAnimator.psd` is a 664×900 document containing, bottom to top:

- `Base` — empty transparent spacer (ignore or delete)
- A **viseme swap set**, one layer per Adobe viseme, already named so Character Animator
  auto-maps them: `Neutral, Aa, D, Ee, F, L, M, Oh, R, S, Uh, W-Oo, Smile, Surprised`
- `Blink` — eyes-closed frame on top, for auto/tracked blinking

Viseme → source mapping baked in:

| Ch viseme | Wizard file            |  | Ch viseme | Wizard file            |
|-----------|------------------------|--|-----------|------------------------|
| Neutral   | 10_Mouth_Closed        |  | Oh        | 22_Phoneme_O           |
| Aa        | 20_Phoneme_A           |  | R         | 22_Phoneme_O (reuse)   |
| D         | 11_Mouth_SlightOpen    |  | S         | 11_Mouth_SlightOpen(re)|
| Ee        | 21_Phoneme_E           |  | Uh        | 12_Mouth_HalfOpen      |
| F         | 25_Phoneme_FV          |  | W-Oo      | 23_Phoneme_U           |
| L         | 26_Phoneme_L           |  | Smile     | 72_Expression_Happy    |
| M         | 24_Phoneme_MBP         |  | Surprised | 14_Mouth_WideOpen      |

---

## 2. Phase 1 — Talking puppet (core, ~15 min)

1. Open **Adobe Character Animator** → **New Project** (save it in the `Pirate_Mascot` folder).
2. **File → Import** → select `WizardPirate_CharacterAnimator.psd`. It appears in the Project panel.
3. Double-click the puppet to open the **Rig** workspace.
4. In the layer list, select the 14 viseme layers (`Neutral … Surprised`), right-click →
   **Group**, and name the group **`+Mouth`** (the `+` makes it an independent group).
   - With a group literally named a viseme set, Character Animator attaches the **Lip Sync**
     behavior and maps each layer by name automatically. Confirm in the **Properties** panel that
     Lip Sync shows all visemes filled.
5. Select the `Blink` layer → in **Properties** add/confirm it is used by the **Face → Blink**
   (name the layer `Blink` — already done — so eye-tracking + auto-blink toggle it).
6. Set the **Neutral** viseme visible, hide the rest, hide `Blink`. Click **Set Rest Pose**.
7. Switch to the **Record/Controls** workspace, enable **Camera & Microphone**, click
   **Set Rest Pose** again while facing forward to calibrate.
8. Talk. The pirate should lip-sync; blink when you blink. If lip-sync looks laggy, use
   **Timeline → Compute Lip Sync from Scene Audio** for recorded takes.

---

## 3. Phase 2 — Head turning (optional, ~10 min)

Uses the `05_Head_Turns` / `06_Up_Down` frames with Character Animator's **Head Turner** behavior.

1. In the Rig, import (File → Import → *as layers*) the closed-mouth angle frames:
   `40_Head_Left15_Closed, 43_Head_Left30_Closed, 46_Head_Right15_Closed, 49_Head_Right30_Closed,
   60_Head_Down15_Closed, 66_Head_Up15_Closed`, plus `01_Body_Neutral` as the front view.
2. Put them in a group, add the **Head Turner** behavior, and assign:
   Frontal = Neutral · Right Quarter = Right15 · Right Profile = Right30 · Left Quarter = Left15 ·
   Left Profile = Left30 · Up = Up15 · Down = Down15.
3. Head Turner now switches views as you physically turn/tilt your head.
   Note: this is a separate front-facing puppet mode from the talking swap set — keep them as two
   scenes if you want either "talking front" or "turning", since full visemes per angle don't exist.

---

## 4. Phase 3 — Expressions, poses & sticker alerts (Triggers)

Bind Wizard's full-body poses to keyboard/Stream Deck keys.

1. **Window → Triggers.** For each of `07_Expressions`, `08_Actions`, `09_Stickers_Alerts` you
   want, drag the PNG into the Triggers panel (or import it as a layer first) and assign a key.
2. Suggested binds: ThumbsUp, Celebrating, `110_Sticker_Sold`, `104_Sticker_Fire`,
   `105_Sticker_GG`, Angry, Shocked. Tap mid-break to fire the reaction.
3. Triggers set to **Latch** stay until pressed again; **Momentary** shows while held.

---

## 5. Phase 4 — Output to OBS (transparent) and into the neon frame

Pick ONE method.

**Method A — Chroma key (no extra install):**
1. In Character Animator, set the **Scene** background to solid green
   (Scene panel → background color).
2. In OBS: **+ → Window Capture** → the Character Animator **Scene** window.
3. Add a **Filter → Chroma Key** (green) to that source.

**Method B — NDI (cleanest, true transparency):**
1. Install the **DistroAV / obs-ndi** plugin for OBS (and the NDI runtime).
2. In Character Animator: **File → Mercury Transmit** (or Live Output) → enable an **NDI** device.
3. In OBS: **+ → NDI Source** → pick the Character Animator output. Transparency is preserved; no keying.

Then:
4. Scale/position the pirate in the lower area of your scene, **inside** the neon BTC facecam frame
   (`btc-facecam-neon.html`). Put the mascot source **below** the neon-frame browser source in OBS
   so the frame draws around it.
5. Keep your real webcam running (it feeds Character Animator's tracking) but it does **not** need
   to be visible in the scene — viewers only see the pirate.

---

## 6. Troubleshooting

| Symptom | Fix |
|--------|-----|
| Lip sync not moving | Confirm the mic is selected in Ch; the `+Mouth` group must contain the viseme-named layers; re-run Compute Lip Sync. |
| Mouth "sticks" open | Set Rest Pose on the Neutral viseme; lower Lip Sync strength. |
| Two pirates / doubling | Only ONE viseme visible at rest; make sure extra full-frame layers aren't all visible outside the swap group. |
| Blink never fires | Layer must be named `Blink` and sit above the mouth group; enable Face → Blink. |
| OBS shows a green box | Method A: add/adjust the Chroma Key filter. Method B preferred. |
| Head turn snaps hard | Expected with full-frame assets; reduce Head Turner sensitivity or keep front-facing. |

---

## 7. Files

- PSD: `…/Pirate_Mascot/WizardPirate_CharacterAnimator.psd`
- Source library: `…/Pirate_Mascot/` (folders 00–09)
- Neon facecam frame: `card-break-overlay/overlays/btc/btc-facecam-neon.html`
