// Rabbit Hole Engine — proxy (the "kitchen")
// Board-approved build, 2026-10-30. Implements the shared format v1 exactly:
//   ~/workspace/goals/meta-global-ai-developer-hackathon-prep/files/rabbit-hole-engine-shared-format-v1.md
//
// What this file is:
//   A single web-standard request handler (fetch / Request / Response / JSON).
//   No Node-only APIs, no dependencies. The same file runs as a Cloudflare
//   Worker (default export below) or locally through server.mjs.
//
// What it does:
//   1. Receives the agreed request JSON from the frontend.
//   2. Calls the Meta Model API with Andrea's key (server-side only, from env).
//   3. Parses the model's reply (locked prompt format: ANSWER / DOORS / TRAIL_LABEL).
//   4. VALIDATES it: usable answer + exactly three distinct doors + trail label.
//      Invalid -> ONE controlled retry with a repair note. Still invalid ->
//      the failure shape { "error": "..." }. The journey is never touched here;
//      it lives on the client and only advances on a validated response.
//   5. Returns the agreed response JSON.
//
// V1 exclusions (board-locked): no database, no auth, no personal memory.

// ---------------------------------------------------------------------------
// The locked system prompt (verbatim from
// rabbit-hole-engine-meta-api-system-prompt.md — change it THERE by board
// vote, then copy it here; do not drift the two apart silently).
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are the Rabbit Hole Engine. You make curiosity navigable. A user asks one question; you answer it well, then you offer three doors — three genuinely different next directions — so the user never has to know what to ask next. Every door keeps a meaningful connection to the journey so far.

### Answer rules
- Answer the current question directly, honestly, and completely enough to satisfy — then stop.
- **Length: 120–180 words maximum for the answer body.** Short paragraphs (1–3 sentences each). Mobile-readable. No padding, no repeating the question back, no long introductions.
- Be accurate about uncertainty: if the science is contested, say what the best studies found AND what they didn't, in plain language. Curious, never gullible; never present speculation as fact.
- Never make the user feel dumb, corrected, or behind. The point is curiosity, not correction. No "actually, it's simple" energy.
- Plain, warm, vivid language. One good concrete detail or example beats three abstract ones.

### The three doors (offer exactly three, one of each, after every answer)
1. **ELABORATE** — Go deeper on the question just asked: the mechanism, the evidence, the "wait, how does that actually work" layer. Title it as a specific question or claim, not "Learn more."
2. **DISCOVER** — A related direction the user probably would not think to ask, picked because of where this journey has been heading. It must open a new room, not re-enter the current one. This is the door that should make a finger twitch.
3. **RE-SEE** — The same topic seen a different way: an everyday analogy, a scale model, a thought experiment the user can run, a story, or a rewording that makes the hard part click. Not a simpler repeat — a different angle.

Door rules:
- Each door gets: a short title (max ~10 words, phrased as a question or hook) and one sentence on why it's worth opening.
- The three doors must be genuinely different from each other and from every topic already in the journey trail. Never offer a door that loops back to a topic already visited unless it clearly goes deeper in a new way.
- Use the journey trail: if the user has been heading in a direction (e.g. repeatedly choosing afterlife / memory / how-things-work doors), let Discover lean that way — inside one journey, learning the user's direction is the product working. Do not assume anything about the user beyond this journey.

### Output format (follow exactly, every turn)
ANSWER:
<the answer body, 120–180 words max>

DOORS:
1. ELABORATE | <title> | <one-sentence hook>
2. DISCOVER | <title> | <one-sentence hook>
3. RE-SEE | <title> | <one-sentence hook>

TRAIL_LABEL:
<3–6 word label for this hop, for the journey trail — e.g. "Precognitive dreams — do they predict?">

### Journey state
- The app sends you the journey so far (topics visited and doors chosen). Treat it as memory: stay coherent with it, build on it, never contradict or repeat an earlier answer, and never restart unless the user presses restart / asks a completely new starting question.
- On a restart or a brand-new starting question, answer fresh with no reference to the previous journey.

### Hard rules
- Stay honest about what is known, contested, and unknown — especially on supernatural-sounding topics: give the evidence and its limits, kindly, without mocking the question.
- Keep everything appropriate for a general audience.
- Never ask for personal information. The journey is the only context you use.
- If a question is unclear, answer the most likely reading and let the doors cover the other readings.`;

// ---------------------------------------------------------------------------
// Config (all overridable by environment — see SETUP.md)
//   META_API_KEY   required. Andrea's key. Server-side only, never in code.
//   META_MODEL     default "muse-spark-1.3"
//   META_API_BASE  default "https://api.meta.ai/v1"  (Chat Completions shape)
// ---------------------------------------------------------------------------
const DEFAULT_MODEL = "muse-spark-1.3";
const DEFAULT_BASE = "https://api.meta.ai/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function failure(message, status = 502) {
  return json({ error: message }, status);
}

// ---------------------------------------------------------------------------
// Request validation — the agreed request shape, strictly enforced.
// (Strengthened per Miles's code review, 2026-10-30: one turn type per
// request, no empty/whitespace payloads, size limits, and journey/style
// entries validated rather than accepted as arbitrary array contents.)
// ---------------------------------------------------------------------------
const DOOR_TYPES = ["elaborate", "discover", "resee"];

const LIMITS = {
  question: 500,        // chars
  selected_prompt: 300, // chars
  current_topic: 200,   // chars
  journey_entries: 50,
  journey_topic: 200,   // chars per entry
  styles: 20,           // entries
  style: 50,            // chars per entry
};

const isBlank = (v) => typeof v !== "string" || v.trim().length === 0;

function validateClientRequest(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }
  const { question, door, selected_prompt, current_topic, journey, styles_used } = body;

  if (door !== null && door !== undefined && !DOOR_TYPES.includes(door)) {
    return "'door' must be elaborate, discover, resee, or null.";
  }
  const hasQuestion = question !== null && question !== undefined;
  const hasDoor = door !== null && door !== undefined;
  const hasPrompt = selected_prompt !== null && selected_prompt !== undefined;

  // Exactly one turn type per request — never both, never neither.
  if (hasQuestion && hasDoor) {
    return "Send either a new starting 'question' or a 'door' press, not both.";
  }
  if (!hasQuestion && !hasDoor) {
    return "Send a starting 'question' or a 'door' press.";
  }

  if (hasQuestion) {
    // Starting-question turn: a real question, and no door fields.
    if (isBlank(question)) return "'question' must not be empty.";
    if (question.length > LIMITS.question) return `'question' is too long (max ${LIMITS.question} characters).`;
    if (hasPrompt) return "'selected_prompt' belongs to a door press; leave it null for a starting question.";
  } else {
    // Door turn: a valid door and the exact text of the door that was pressed.
    if (!hasPrompt || isBlank(selected_prompt)) {
      return "A door press must include the 'selected_prompt' text of the door chosen.";
    }
    if (selected_prompt.length > LIMITS.selected_prompt) {
      return `'selected_prompt' is too long (max ${LIMITS.selected_prompt} characters).`;
    }
  }

  if (current_topic !== null && current_topic !== undefined) {
    if (typeof current_topic !== "string") return "'current_topic' must be a string or null.";
    if (current_topic.length > LIMITS.current_topic) {
      return `'current_topic' is too long (max ${LIMITS.current_topic} characters).`;
    }
  }

  if (journey !== undefined) {
    if (!Array.isArray(journey)) return "'journey' must be an array.";
    if (journey.length > LIMITS.journey_entries) {
      return `'journey' is too long (max ${LIMITS.journey_entries} steps).`;
    }
    for (const step of journey) {
      if (step === null || typeof step !== "object" || Array.isArray(step)) {
        return "Each 'journey' step must be an object with 'topic' and 'door'.";
      }
      if (isBlank(step.topic)) return "Each 'journey' step needs a non-empty 'topic'.";
      if (step.topic.length > LIMITS.journey_topic) {
        return `A 'journey' topic is too long (max ${LIMITS.journey_topic} characters).`;
      }
      if (step.door !== null && step.door !== undefined && !DOOR_TYPES.includes(step.door)) {
        return "Each 'journey' step's 'door' must be elaborate, discover, resee, or null.";
      }
    }
  }

  if (styles_used !== undefined) {
    if (!Array.isArray(styles_used)) return "'styles_used' must be an array.";
    if (styles_used.length > LIMITS.styles) {
      return `'styles_used' has too many entries (max ${LIMITS.styles}).`;
    }
    for (const style of styles_used) {
      if (isBlank(style)) return "Each 'styles_used' entry must be a non-empty string.";
      if (style.length > LIMITS.style) {
        return `A 'styles_used' entry is too long (max ${LIMITS.style} characters).`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Build the user-turn brief the model sees. The system prompt is locked;
// this brief is the proxy's own deterministic construction from the agreed
// request fields.
// ---------------------------------------------------------------------------
function buildUserMessage(req, isRetry) {
  const lines = [];
  const journey = Array.isArray(req.journey) ? req.journey : [];
  const styles = Array.isArray(req.styles_used) ? req.styles_used : [];

  if (journey.length > 0) {
    lines.push("Journey so far (oldest first):");
    for (const step of journey) {
      const via = step && step.door ? ` (arrived via ${String(step.door).toUpperCase()})` : "";
      lines.push(`- ${step && step.topic ? step.topic : "?" }${via}`);
    }
    lines.push("");
  }
  if (styles.length > 0) {
    lines.push(`Explanation styles already used this journey: ${styles.join(", ")}. Vary the Re-see lens — do not reuse these.`);
    lines.push("");
  }

  if (req.door) {
    lines.push(`Current topic: ${req.current_topic || "(see journey)"}`);
    lines.push(`The user chose the ${req.door.toUpperCase()} door: "${req.selected_prompt}"`);
    lines.push("Answer that door's question now, as the next step of this journey, then offer three fresh doors.");
  } else {
    lines.push(`New starting question: ${req.question}`);
    lines.push("Answer it, then offer the three doors.");
  }

  if (isRetry) {
    lines.push("");
    lines.push("IMPORTANT: your previous reply did not match the required output format. Reply again, following the Output format section EXACTLY: an ANSWER section, a DOORS section with exactly three doors (1. ELABORATE, 2. DISCOVER, 3. RE-SEE, each as 'TITLE | one-sentence hook'), and a TRAIL_LABEL section.");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Parse + validate the model's reply (locked prompt format).
// Returns the agreed response object, or null if the reply is not usable.
// Adaptation (board-reviewable, see shared-format doc): per door,
//   text  = "<title> — <hook>"
//   topic = the door's title
// and response.current_topic = this hop's trail_label.
// ---------------------------------------------------------------------------
const DOOR_LINE = /^\s*\d+\s*[.)]\s*(ELABORATE|DISCOVER|RE-SEE)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*$/i;

function parseModelOutput(text) {
  if (typeof text !== "string") return null;

  const answerMatch = text.match(/ANSWER:\s*([\s\S]*?)(?=\n\s*DOORS:|$)/i);
  const doorsMatch = text.match(/DOORS:\s*([\s\S]*?)(?=\n\s*TRAIL_LABEL:|$)/i);
  const trailMatch = text.match(/TRAIL_LABEL:\s*(.+)/i);
  if (!answerMatch || !doorsMatch || !trailMatch) return null;

  const answer = answerMatch[1].trim();
  const trail_label = trailMatch[1].trim();
  if (!answer || !trail_label) return null;

  // The DOORS section must contain EXACTLY three non-blank lines, every one
  // of them a correctly formatted door line — additional or malformed door
  // entries invalidate the whole reply (Miles's code review, 2026-10-30).
  const doorLines = doorsMatch[1].split("\n").filter((l) => l.trim().length > 0);
  if (doorLines.length !== 3) return null;

  const byType = {};
  const titles = new Set();
  for (const line of doorLines) {
    const m = line.match(DOOR_LINE);
    if (!m) return null; // a non-blank line that isn't a door line = malformed
    const type = m[1].toLowerCase().replace("re-see", "resee");
    const title = m[2].trim();
    const hook = m[3].trim();
    if (!title || !hook) return null;
    if (byType[type]) return null; // same door type twice
    const titleKey = title.toLowerCase();
    if (titles.has(titleKey)) return null; // duplicate door title, even if hooks differ
    titles.add(titleKey);
    byType[type] = { type, text: `${title} — ${hook}`, topic: title };
  }
  const doors = DOOR_TYPES.map((t) => byType[t]);
  if (doors.some((d) => !d)) return null; // need exactly one of each
  // Note: deeper semantic distinctness (do the doors really lead different
  // places?) is an evaluation goal for testing, not something string checks
  // can guarantee — the checks above enforce structure only, honestly.

  return { answer, doors, trail_label, current_topic: trail_label };
}

// ---------------------------------------------------------------------------
// The Meta Model API call (OpenAI-compatible Chat Completions shape).
// ---------------------------------------------------------------------------
async function callModel(env, userMessage) {
  const base = (env.META_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");
  const model = env.META_MODEL || DEFAULT_MODEL;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.META_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0.7,
      // muse-spark is a reasoning model: reasoning tokens draw from this
      // same budget (a trivial "say hello" call burned 219 reasoning
      // tokens). 900 starved the visible answer entirely — the reply came
      // back with no content. 4000 leaves room to think AND answer; the
      // prompt itself still caps the visible answer at 120-180 words.
      max_tokens: 4000,
    }),
  });
  if (!res.ok) {
    // Surface Meta's own error code/message for the server-side log. This
    // body never contains our key; the client still sees only the polite
    // failure sentence.
    let detail = "";
    try {
      const errBody = await res.json();
      const code = errBody && errBody.error && (errBody.error.code || errBody.error.type);
      const msg = errBody && errBody.error && errBody.error.message;
      if (code || msg) detail = ` (${[code, msg].filter(Boolean).join(": ")})`;
    } catch {
      // Non-JSON error body — the status alone still helps.
    }
    throw new Error(`Meta Model API returned ${res.status}${detail}`);
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content
    : null;
  if (typeof content !== "string") {
    // Log the mechanism, not just the symptom: finish_reason "length"
    // plus heavy reasoning tokens means the budget ran out mid-thought.
    const choice = (data && data.choices && data.choices[0]) || {};
    const usage = (data && data.usage) || {};
    const detail = [
      choice.finish_reason ? `finish_reason=${choice.finish_reason}` : "",
      usage.completion_tokens != null ? `completion_tokens=${usage.completion_tokens}` : "",
      usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens != null
        ? `reasoning_tokens=${usage.completion_tokens_details.reasoning_tokens}`
        : "",
    ].filter(Boolean).join(", ");
    throw new Error(`Meta Model API reply had no message content${detail ? ` (${detail})` : ""}`);
  }
  return content;
}

// ---------------------------------------------------------------------------
// The handler.
// ---------------------------------------------------------------------------
export async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return failure("This endpoint only takes POST requests.", 405);
  }
  if (!env || !env.META_API_KEY) {
    return failure("The engine isn't set up yet — the server is missing its API key.", 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return failure("That request wasn't readable. Nothing was changed — try again.", 400);
  }
  const shapeError = validateClientRequest(body);
  if (shapeError) {
    return failure(`That request was incomplete: ${shapeError} Nothing was changed.`, 400);
  }

  // One attempt + ONE controlled retry. Any failure after that returns the
  // failure shape; the client's journey is untouched by anything here.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await callModel(env, buildUserMessage(body, attempt === 1));
      const parsed = parseModelOutput(raw);
      if (parsed) return json(parsed, 200);
      // Server-side only: name the validation failure in the server
      // terminal / Worker logs. Client message stays polite and unchanged;
      // no key, request body, or model reply text is logged.
      console.error('[rhe-proxy] attempt', attempt + 1, 'reply failed validation');
    } catch (err) {
      // upstream error counts as a failed attempt; fall through to retry/fail
      // Server-side only: log the real upstream error (status/message).
      console.error('[rhe-proxy] attempt', attempt + 1, 'failed:', err && err.message ? err.message : err);
    }
  }
  return failure("Something went wrong getting your next step. Your journey is exactly where you left it — try again.", 502);
}

// Cloudflare Workers entry point (same handler; locally, server.mjs adapts).
export default {
  fetch: (request, env) => handleRequest(request, env),
};
