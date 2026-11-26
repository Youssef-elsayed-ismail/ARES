// How ARES answers. There is no language model here: every answer is either computed by a tool or retrieved from a
// written knowledge base, and each one names its source.
//
//   question -> 1. NAVIGATION tool : turn-by-turn directions read off the real A* path (never a straight-line guess)
//               2. STATE tools     : oxygen, the ground under your feet, the risk of the next jump
//               3. RETRIEVAL       : BM25 search over data/knowledge.json, with live numbers filled in
//               4. fallback        : says what it can answer

const STOP = new Set("a an the is are was were be to of in on at for and or it its this that with do does did how what where when can could would should i you my your me we our he she they them there here about from as by if so than then too very just not no".split(" "));
const words = (s) => s.toLowerCase().replace(/[^a-z0-9*°'é ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));

// Words that shape a question but say nothing about its subject. A match on these alone is not a match.
const GENERIC = new Set("who whom whose why which tell explain mean meaning much many long thing name called work happen say know give show can't cannot don't doesn't isn't aren't won't didn't get got make made need want like".split(" "));

let docs = [], idf = new Map(), avgLen = 1;

/** Index the knowledge base (BM25): how rare each word is, and how long each entry is. */
export function index(kb) {
  docs = kb.map((d) => { const terms = [...words(d.title), ...words(d.tags), ...words(d.tags), ...words(d.text)], tf = new Map(); terms.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1)); return { ...d, tf, len: terms.length }; });
  avgLen = docs.reduce((n, d) => n + d.len, 0) / docs.length;
  const df = new Map(); docs.forEach((d) => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  df.forEach((n, t) => idf.set(t, Math.log(1 + (docs.length - n + 0.5) / (n + 0.5))));
}

/** Best-matching entry for a question, or null when nothing in the knowledge base is a real match. */
export function retrieve(question, vars = {}) {
  const q = words(question); let best = null, top = 0;
  for (const d of docs) {
    let score = 0;
    for (const t of q) { const f = d.tf.get(t); if (f) score += idf.get(t) * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avgLen)); }
    if (score > top) { top = score; best = d; }
  }
  if (!best || top < 1.1) return null;
  // The subject of the question has to be in the entry. "Who is the president" shares only "who" with anything here,
  // so it is refused instead of being answered with whatever entry happens to contain "who".
  const subject = q.filter((t) => !GENERIC.has(t));
  if (subject.length) {
    const found = subject.filter((t) => best.tf.has(t)).length, unknown = subject.filter((t) => !idf.has(t)).length;
    if (found < Math.ceil(subject.length / 2) || unknown >= found) return null;
  }
  const fill = (s) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : "?"));
  return { text: fill(best.text), source: fill(best.source), id: best.id, score: top, next: related(best) };
}

/** Questions worth asking next: the entries that share the most topic words with this one. */
function related(d, n = 3) {
  const mine = new Set(words(d.tags));
  return docs.filter((o) => o !== d && o.ask).map((o) => [words(o.tags).filter((t) => mine.has(t)).length + Math.random() * 0.5, o.ask]).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]);
}
/** A few questions from the knowledge base, for when there is nothing more specific to suggest. */
export const someQuestions = (n = 2) => docs.filter((d) => d.ask).map((d) => [Math.random(), d.ask]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);

/** A path of tile indices -> the turns a walker actually makes: [{dir:"up", n:3}, {dir:"left", n:5}, ...] */
export function turns(path, cols) {
  const out = [];
  for (let k = 1; k < path.length; k++) {
    const dx = (path[k] % cols) - (path[k - 1] % cols), dy = ((path[k] / cols) | 0) - ((path[k - 1] / cols) | 0);
    const dir = dx > 0 ? "right" : dx < 0 ? "left" : dy > 0 ? "down" : "up";
    if (out.length && out[out.length - 1].dir === dir) out[out.length - 1].n++; else out.push({ dir, n: 1 });
  }
  return out;
}

/** Say the first few turns out loud, then how far it is in all. */
export function directions(segs, shown = 4) {
  if (!segs.length) return "You are standing on it.";
  const total = segs.reduce((n, s) => n + s.n, 0), first = segs.slice(0, shown).map((s) => `${s.n} ${s.dir}`).join(", then ");
  return `${first}${segs.length > shown ? `, then ${segs.length - shown} more turns` : ""}. ${total} jumps in all.`;
}
