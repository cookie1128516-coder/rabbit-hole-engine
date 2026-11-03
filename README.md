# Rabbit Hole Engine

**We're not demonstrating an AI that answers questions, we're demonstrating an AI that makes curiosity navigable.**

Rabbit Hole Engine lets a user ask one question, receive a focused answer, and then choose among three genuinely different next directions:

- **Elaborate** — go deeper on the question just asked.
- **Discover** — take a related direction picked for the user.
- **Re-see** — see the same thing explained a different way.

The page remembers the current topic, displays a visible chronological journey trail, and provides restart. There are no accounts or profiles in v1.

**Live demo:** https://rabbit-hole-engine.rabbit-hole-engine.workers.dev

## Built during the event

Rabbit Hole Engine was conceived and built during the Meta Global AI Developer Hackathon, October 26–November 4, 2026.

Created during the event:

- The follow-up prompt system: a base draft was generated with AI assistance at Andrea Conklin's request; Andrea reworked the wording, defined the behavior, and tested it in live chains.
- The three navigation doors and their locked meanings, decided October 27–28.
- The demo application: one mobile-friendly page with a question box, answer, three working door buttons, journey memory, a visible chronological journey trail, and restart.
- The deployed application, running on the Meta Model API (Muse Spark 1.3) through a Cloudflare Workers proxy. The API key is held only as a sealed Cloudflare secret and is never stored in this repository.
- The 1-minute-39-second demo video: Andrea recorded a silent journey on the hosted build — Book of Enoch → Elaborate: Watchers → Discover: Book of Giants → Re-see: the Flood through the giants' eyes → Discover: the giants' book reaches China — and Muse added narration and edited the 2:27 recording to 1:39 under Plan B. Andrea approved the final video on November 2, 2026.

## Testing evidence

- The live backend passed question and Discover-door smoke tests before frontend integration.
- The deployed public build was verified on Andrea's phone and tablet with the build laptop uninvolved.
- First outside user test, November 1, 2026: Powers received only the live link, chose his own question — "How does reaction time within the brain improve?" — and completed four turns through two Elaborate doors and one Discover door, with the journey trail updating 1–4 and no repetition or hiccups. His unsolicited verdict was that it "helps push to learn more about why things work and how they operate."

## AI assistance and credit

This project was built by Andrea Conklin working with AI assistants, and that help is disclosed rather than hidden. AI tools assisted with drafting prompt wording, systematizing the build spec, and documentation. Direction, product decisions, door definitions, testing, and the live demonstration are Andrea Conklin's.

Build spec and product framing were developed with Miles, an AI assistant on the project's three-member board (Andrea Conklin, Miles, and Muse): Miles systematized the minimum build spec, framed the pitch — making curiosity navigable — supplied the frontend integration procedure, and reviewed the live-backend patch before deployment. Direction, product decisions, door definitions, testing, and the live demonstration are Andrea Conklin's.

## Repository layout

- `rabbit-hole-engine/` — the frontend (React + Vite). `npm install`, then `npm run build` produces the `dist/` the Worker serves.
- `rhe-deploy/` — the Cloudflare Worker: `proxy.js` (the stateless proxy that formats requests, validates every model response, and never exposes the API key) and `wrangler.jsonc`, which points at the frontend build in `../rabbit-hole-engine/dist`. The key is supplied only as the sealed `META_API_KEY` Cloudflare secret.
- `system-prompt.md` — the locked system prompt that defines the three doors and the response format.

## Not part of this submission

- *Hint and Solve*, a homework-tutor project Andrea designed before the event and first built as a Poe bot on October 24, is a separate project. It is parked, not abandoned, and is not part of this submission.
- A ChatGPT GPT prototype of Rabbit Hole Engine served only as a behavior test bed. The submitted application runs on the Meta stack at the live URL above.
