/**
 * Choosing a voice that is pleasant to be spoken to by, all day.
 *
 * Two things decide whether a synthesised voice is soothing, and only one of
 * them is the voice itself:
 *
 *   1. **Quality tier.** Apple ships three. `default` voices are the old
 *      compact synths — thin, buzzy, and tiring within minutes. `enhanced` and
 *      `premium` are neural and sound close to a recording. The gap between
 *      tiers is far larger than the gap between two voices in the same tier,
 *      so quality dominates the ranking below. Premium voices are an opt-in
 *      download, so Pitwall detects what is present rather than assuming.
 *
 *   2. **Delivery.** A slower rate and a slightly lowered pitch make the same
 *      voice read as calm rather than clipped. AVSpeechSynthesizer's default
 *      rate (0.5) is tuned for screen-reader efficiency, not for company —
 *      every preset here is slower than that.
 *
 * Novelty and Eloquence voices are excluded outright. "Zarvox" is not a voice
 * anyone wants confirming a destructive git operation.
 */

/**
 * Soothing ranking within a quality tier. Higher is better. Chosen for warmth
 * and evenness of tone rather than for accent — accent is a preference, and
 * the picker lets it be set.
 */
const SOOTHING_RANK = {
  // Neural voices, warmest first.
  ava: 100,
  serena: 96,
  zoe: 94,
  isha: 90,
  nathan: 88,
  evan: 86,
  noelle: 84,
  stephanie: 82,
  matilda: 80,
  jamie: 78,
  malcolm: 76,
  // Long-standing voices that also exist as compact.
  allison: 74,
  susan: 72,
  samantha: 70,
  moira: 68,
  fiona: 66,
  karen: 60,
  daniel: 58,
  tessa: 56,
  rishi: 54,
  oliver: 52,
  arthur: 50,
};

/** Novelty, singing and legacy-formant voices. Never offered. */
const EXCLUDED = new Set([
  "albert", "badnews", "bahh", "bells", "boing", "bubbles", "cellos", "deranged",
  "wobble", "fred", "goodnews", "hysterical", "jester", "junior", "kathy",
  "organ", "princess", "superstar", "ralph", "trinoids", "whisper", "zarvox",
  "eddy", "flo", "grandma", "grandpa", "reed", "rocko", "sandy", "shelley",
  "grandpa", "bruce", "agnes", "victoria", "vicki", "alex",
]);

const QUALITY_WEIGHT = { premium: 3000, enhanced: 2000, default: 0 };

/**
 * Delivery presets. `rate` is AVSpeechUtterance's 0–1 scale (0.5 is its
 * default); `pitch` is the 0.5–2.0 multiplier; `volume` is 0–1.
 */
const PRESETS = Object.freeze({
  calm: {
    id: "calm",
    label: "Calm",
    description: "Unhurried and even. The default.",
    rate: 0.46,
    pitch: 0.96,
    volume: 0.95,
  },
  warm: {
    id: "warm",
    label: "Warm",
    description: "Slower and lower — the most soothing setting.",
    rate: 0.43,
    pitch: 0.92,
    volume: 0.95,
  },
  night: {
    id: "night",
    label: "Late night",
    description: "Quietest and slowest, for working after hours.",
    rate: 0.41,
    pitch: 0.9,
    volume: 0.72,
  },
  focused: {
    id: "focused",
    label: "Focused",
    description: "Natural pace, for when you want answers quickly.",
    rate: 0.52,
    pitch: 1,
    volume: 1,
  },
});

const DEFAULT_PRESET = "calm";

function normalizeName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z]/g, "");
}

function qualityName(quality) {
  if (quality === 3 || quality === "premium") return "premium";
  if (quality === 2 || quality === "enhanced") return "enhanced";
  return "default";
}

/**
 * Score a voice for how pleasant it is to listen to repeatedly.
 * Returns 0 for voices that should never be offered.
 */
function scoreVoice(voice) {
  const key = normalizeName(voice.name);
  if (!key || EXCLUDED.has(key)) return 0;
  const rank = SOOTHING_RANK[key];
  // An unknown name is probably a voice Apple added later. Offer it, but below
  // everything curated in the same tier.
  const base = rank ?? 30;
  return QUALITY_WEIGHT[qualityName(voice.quality)] + base;
}

/**
 * Rank installed voices, best first. `locale` nudges matching languages up so
 * an Irish user is not handed a South African accent by default, without
 * hiding the others.
 */
function rankVoices(voices, { locale = "en-US" } = {}) {
  const language = String(locale).slice(0, 2).toLowerCase();
  const exact = String(locale).toLowerCase();

  return (Array.isArray(voices) ? voices : [])
    .map((voice) => {
      const score = scoreVoice(voice);
      if (!score) return null;
      const voiceLocale = String(voice.language || "").toLowerCase();
      if (!voiceLocale.startsWith(language)) return null;
      // A same-locale voice wins ties, but never beats a higher quality tier.
      const localeBonus = voiceLocale === exact ? 200 : 0;
      return {
        identifier: voice.identifier,
        name: voice.name,
        language: voice.language,
        quality: qualityName(voice.quality),
        score: score + localeBonus,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** The voice Pitwall should use when the user has not chosen one. */
function pickDefaultVoice(voices, options) {
  return rankVoices(voices, options)[0] || null;
}

/**
 * Whether the machine is missing the neural voices. Used to explain *why*
 * everything sounds thin, rather than leaving the user to conclude the feature
 * is just poor.
 */
function describeVoiceQuality(voices) {
  const ranked = rankVoices(voices, { locale: "en" });
  const best = ranked[0]?.quality ?? "default";
  if (best === "default") {
    return {
      best,
      needsDownload: true,
      message:
        "Only Apple's compact voices are installed, which is why Pitwall sounds thin. " +
        "Open System Settings › Accessibility › Spoken Content › System Voice › Manage Voices and download an English voice marked Premium or Enhanced — Ava, Zoe or Serena are the most soothing. Pitwall will pick it up automatically.",
    };
  }
  return { best, needsDownload: false, message: "" };
}

function resolvePreset(id) {
  return PRESETS[id] || PRESETS[DEFAULT_PRESET];
}

/** The config object the Swift daemon expects for a given choice. */
function toSidecarConfig({ voiceIdentifier, preset, locale } = {}) {
  const resolved = resolvePreset(preset);
  return {
    voice: voiceIdentifier || undefined,
    speechRate: resolved.rate,
    pitch: resolved.pitch,
    volume: resolved.volume,
    locale: locale || "en-US",
  };
}

module.exports = {
  PRESETS,
  DEFAULT_PRESET,
  rankVoices,
  pickDefaultVoice,
  describeVoiceQuality,
  scoreVoice,
  resolvePreset,
  toSidecarConfig,
  qualityName,
};
