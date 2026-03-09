import CryptoJS from 'crypto-js'

// ─── Legacy (v1) — CryptoJS AES with EVP_BytesToKey/MD5 ────────────────────
// Kept ONLY for decrypting existing blocks. New encryptions always use v2.

function legacyDecrypt(ciphertext: string, password: string): string | null {
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, password)
    if (!bytes || bytes.sigBytes < 0) return null
    if (bytes.sigBytes === 0) return ''
    const decrypted = bytes.toString(CryptoJS.enc.Utf8)
    if (!decrypted) return null
    return decrypted
  } catch {
    return null
  }
}

/** Sync legacy encrypt — used ONLY for the useEffect unmount cleanup where
 *  async is impossible. The block will be re-encrypted with v2 on next blur. */
function legacyEncrypt(text: string, password: string): string {
  return CryptoJS.AES.encrypt(text, password).toString()
}

// ─── V2 — PBKDF2-SHA256 (600 000 iterations) + AES-256-GCM ─────────────────
// Uses the native Web Crypto API (SubtleCrypto) for performance.
// Format inside {{encrypt:…}}: "v2$" + Base64( salt[16] | iv[12] | ciphertext+tag )
// AES-GCM provides authenticated encryption (integrity + confidentiality).

const V2_PREFIX = 'v2$'
const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12 // AES-GCM standard

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKeyV2(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptV2(text: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKeyV2(password, salt)
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(text),
  )
  // Concatenate: salt(16) + iv(12) + ciphertext+authTag
  const cipher = new Uint8Array(cipherBuf)
  const combined = new Uint8Array(SALT_BYTES + IV_BYTES + cipher.length)
  combined.set(salt, 0)
  combined.set(iv, SALT_BYTES)
  combined.set(cipher, SALT_BYTES + IV_BYTES)
  return V2_PREFIX + uint8ToBase64(combined)
}

async function decryptV2(payload: string, password: string): Promise<string | null> {
  try {
    const data = base64ToUint8(payload)
    if (data.length < SALT_BYTES + IV_BYTES + 1) return null
    const salt = data.slice(0, SALT_BYTES)
    const iv = data.slice(SALT_BYTES, SALT_BYTES + IV_BYTES)
    const cipher = data.slice(SALT_BYTES + IV_BYTES)
    const key = await deriveKeyV2(password, salt)
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipher,
    )
    return new TextDecoder().decode(plainBuf)
  } catch {
    // Wrong password → GCM auth tag mismatch → DOMException
    return null
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function isEncryptedBlock(content: string): boolean {
  return /\{\{encrypt:[^}]+\}\}/.test(content)
}

/** Encrypt a block — async, always uses v2 (PBKDF2 + AES-256-GCM). */
export async function encryptBlock(content: string, password: string): Promise<string> {
  const inner = await encryptV2(content, password)
  return `{{encrypt:${inner}}}`
}

/** Encrypt a block — sync, legacy CryptoJS.
 *  Used ONLY for the React useEffect cleanup on unmount (where async is impossible).
 *  The block will be re-encrypted with v2 on the next blur/unlock cycle. */
export function encryptBlockSync(content: string, password: string): string {
  const inner = legacyEncrypt(content, password)
  return `{{encrypt:${inner}}}`
}

/** Decrypt a block — async, auto-detects v1 (legacy) vs v2 format. */
export async function decryptBlock(content: string, password: string): Promise<string | null> {
  const match = content.match(/\{\{encrypt:([^}]+)\}\}/)
  if (!match) return null
  const inner = match[1]
  if (inner.startsWith(V2_PREFIX)) {
    return decryptV2(inner.slice(V2_PREFIX.length), password)
  }
  // Legacy CryptoJS format (starts with "U2FsdGVkX1" = "Salted__")
  return legacyDecrypt(inner, password)
}
