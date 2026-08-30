// Audience identity: persistent sessionId + a deterministic fun name.

const SESSION_KEY = "rt-session";
const NAME_KEY = "rt-name";

const ADJECTIVES = [
  "Amber", "Bold", "Brave", "Breezy", "Bright", "Bubbly", "Calm", "Cheery",
  "Clever", "Cosmic", "Cozy", "Curious", "Daring", "Dashing", "Dizzy", "Electric",
  "Fancy", "Fuzzy", "Gentle", "Giddy", "Golden", "Groovy", "Happy", "Jolly",
  "Lucky", "Mellow", "Mighty", "Neon", "Nimble", "Peppy", "Plucky", "Quick",
  "Sassy", "Shiny", "Sleepy", "Snappy", "Sparky", "Sunny", "Swift", "Zesty",
];

const ANIMALS = [
  "Alpaca", "Badger", "Beaver", "Bison", "Capybara", "Cheetah", "Chinchilla", "Dolphin",
  "Falcon", "Ferret", "Firefly", "Fox", "Gecko", "Gibbon", "Hedgehog", "Heron",
  "Ibex", "Jackal", "Koala", "Lemur", "Lynx", "Macaw", "Manatee", "Marmot",
  "Meerkat", "Mongoose", "Narwhal", "Ocelot", "Otter", "Panda", "Pangolin", "Penguin",
  "Puffin", "Quokka", "Raccoon", "Sparrow", "Toucan", "Walrus", "Wombat", "Yak",
];

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode / storage disabled — identity just won't persist
  }
}

let memorySessionId: string | null = null;

export function getSessionId(): string {
  const existing = read(SESSION_KEY);
  if (existing) return existing;
  if (memorySessionId) return memorySessionId;
  const id =
    globalThis.crypto?.randomUUID?.() ??
    `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  memorySessionId = id;
  write(SESSION_KEY, id);
  return id;
}

/** FNV-1a 32-bit hash — stable across sessions. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function generateName(seed: string): string {
  const h = hashString(seed);
  const adj = ADJECTIVES[h % ADJECTIVES.length] ?? "Curious";
  const animal = ANIMALS[Math.floor(h / ADJECTIVES.length) % ANIMALS.length] ?? "Otter";
  return `${adj} ${animal}`;
}

export function getName(sessionId: string): string {
  const existing = read(NAME_KEY);
  if (existing && existing.trim()) return existing.trim();
  const generated = generateName(sessionId);
  write(NAME_KEY, generated);
  return generated;
}

export function setName(name: string): string {
  const clean = name.trim().slice(0, 24);
  if (!clean) return getName(getSessionId());
  write(NAME_KEY, clean);
  return clean;
}
