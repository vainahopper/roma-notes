# Encrypted Blocks Security Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four security gaps in encrypted blocks without breaking UX — no extra prompts, no lost edits, no performance regression.

**Architecture:** All changes are surgical edits to `src/renderer/components/BlockItem.tsx`. The iCloud leak is fixed by suppressing `onChange` calls with plaintext while a block is unlocked; the store/disk always holds the encrypted form until blur. Auto-lock uses a single `useRef` timer that resets on every keystroke and fires `reEncrypt` after 5 min of inactivity.

**Tech Stack:** React 19, TypeScript, Web Crypto API (already used)

---

## File Map

| File | Change |
|------|--------|
| `src/renderer/components/BlockItem.tsx:137-178` | Don't call `onChange` with plaintext while `isUnlocked` |
| `src/renderer/components/BlockItem.tsx:66-110` | Add auto-lock timer refs; start timer on unlock; reset on keystroke |
| `src/renderer/components/BlockItem.tsx:829` | `spellCheck={false}` when `isUnlocked` |
| `src/renderer/components/BlockItem.tsx:975-984` | Clear `password` state in EncryptedBlockView after decrypt |

---

## Task 1 — Don't propagate plaintext via onChange (iCloud / disk protection)

**Why this matters:** Every keystroke in an unlocked block calls `onChange(block.id, plaintext)`. The parent store saves immediately → `ipcMain 'pages:save'` → `syncPageToICloud(page)` writes plaintext to `~/Library/Mobile Documents/…`. With this fix the store always holds the encrypted blob; plaintext lives only in the textarea until blur triggers `reEncrypt`.

**Files:**
- Modify: `src/renderer/components/BlockItem.tsx:137-178` (`handleContentChange`)

- [ ] **Step 1: Locate handleContentChange** — it's at line 137. The line `onChange(block.id, val)` is the leak. When `isUnlocked` we only want to update local state.

- [ ] **Step 2: Add the guard**

In `handleContentChange`, replace:
```typescript
setContent(val)
onChange(block.id, val)
```
with:
```typescript
setContent(val)
if (!isUnlocked) onChange(block.id, val)
```

- [ ] **Step 3: Verify reEncrypt still saves** — `reEncrypt` (line 660) already calls `onChange(block.id, encrypted)`. The unmount cleanup (line 99–110) already calls `onChange(block.id, encryptBlockSync(...))`. Both paths save the (encrypted) content on exit. No edits are lost.

- [ ] **Step 4: Commit**
```bash
git add src/renderer/components/BlockItem.tsx
git commit -m "fix(security): don't propagate plaintext via onChange while block is unlocked"
```

---

## Task 2 — Auto-lock after 5 min of inactivity

**Why this matters:** If the user unlocks a block and walks away, it stays decrypted forever. Auto-lock re-encrypts after 5 min of no typing, restoring the visual lock icon.

**UX contract:** Timer resets on every keystroke. Fires silently (no toast, no prompt). User can re-unlock instantly with Touch ID. If the user is mid-sentence and pauses for 5 min, they'll see the block lock — they can re-unlock with Touch ID and resume.

**Files:**
- Modify: `src/renderer/components/BlockItem.tsx` — add timer ref, start on unlock, reset on keystroke

- [ ] **Step 1: Add the timer ref** near the other refs (line ~67):
```typescript
const autoLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
const AUTO_LOCK_MS = 5 * 60 * 1000  // 5 minutes
```

- [ ] **Step 2: Add helper to reset the timer** — place after `reEncrypt` (line ~666):
```typescript
const scheduleAutoLock = useCallback(() => {
  if (autoLockTimerRef.current) clearTimeout(autoLockTimerRef.current)
  autoLockTimerRef.current = setTimeout(() => {
    const pw = unlockPasswordRef.current
    const ct = contentRef.current
    if (pw && ct && !isEncryptedBlock(ct)) {
      reEncrypt(ct, pw)
    }
  }, AUTO_LOCK_MS)
}, [reEncrypt])

const cancelAutoLock = useCallback(() => {
  if (autoLockTimerRef.current) {
    clearTimeout(autoLockTimerRef.current)
    autoLockTimerRef.current = null
  }
}, [])
```

- [ ] **Step 3: Start timer on unlock** — in `handleUnlock` (line ~648), add `scheduleAutoLock()` after `setEditing(true)`:
```typescript
const handleUnlock = useCallback((plaintext: string, password: string) => {
  setUnlockPassword(password)
  setContent(plaintext)
  pendingCursorPos.current = plaintext.length
  justUnlockedRef.current = true
  setEditing(true)
  scheduleAutoLock()   // ← add this
  platform.saveKey(block.id, password).catch(() => {})
  setTimeout(() => { justUnlockedRef.current = false }, 800)
}, [block.id, scheduleAutoLock])
```

- [ ] **Step 4: Reset timer on every keystroke** — in `handleContentChange`, when `isUnlocked`:
```typescript
if (isUnlocked) scheduleAutoLock()
```

- [ ] **Step 5: Cancel timer on manual lock (blur → reEncrypt)** — in `reEncrypt` (line ~660), add `cancelAutoLock()` at the start:
```typescript
const reEncrypt = useCallback(async (currentContent: string, password: string) => {
  cancelAutoLock()   // ← add this
  const encrypted = await encryptBlock(currentContent, password)
  ...
```

- [ ] **Step 6: Cancel on unmount** — add `cancelAutoLock()` in the unmount cleanup useEffect return (line ~100):
```typescript
return () => {
  cancelAutoLock()
  const pw = unlockPasswordRef.current
  ...
```

- [ ] **Step 7: Commit**
```bash
git add src/renderer/components/BlockItem.tsx
git commit -m "feat(security): auto-lock encrypted blocks after 5 min of inactivity"
```

---

## Task 3 — Clear password from EncryptedBlockView state after decrypt

**Why this matters:** `EncryptedBlockView` holds the entered password in `useState('')` (`password` variable, line 922). After `onUnlock` succeeds, the string lingers in the child component's state until the component unmounts. Clearing it immediately reduces the window where it's in memory.

**Files:**
- Modify: `src/renderer/components/BlockItem.tsx:975-984` (`handleDecrypt` in `EncryptedBlockView`)

- [ ] **Step 1: Clear password after successful decrypt** — in `handleDecrypt`:
```typescript
const handleDecrypt = useCallback(async () => {
  const result = await decryptBlock(content, password)
  if (result !== null) {
    setError(false)
    try { await platform.saveKey(blockId, password) } catch {}
    setHasStoredKey(true)
    const pw = password
    setPassword('')   // ← clear before passing up
    onUnlock(result, pw)
  } else {
    setError(true)
  }
}, [blockId, content, password, onUnlock])
```

- [ ] **Step 2: Commit**
```bash
git add src/renderer/components/BlockItem.tsx
git commit -m "fix(security): clear password state in EncryptedBlockView after successful decrypt"
```

---

## Task 4 — spellCheck=false on unlocked block textarea

**Why this matters:** macOS spell-check passes textarea text to OS services (and optionally iCloud). Disabling it for unlocked encrypted blocks prevents the plaintext from leaking through that channel.

**UX impact:** Zero — spell-check only applies to the textarea while typing in an encrypted block (a narrow case). Normal blocks are unaffected.

**Files:**
- Modify: `src/renderer/components/BlockItem.tsx:829` — `<textarea ... spellCheck>`

- [ ] **Step 1: Change spellCheck prop** — at line 848:
```typescript
// Before:
spellCheck

// After:
spellCheck={!isUnlocked}
```

- [ ] **Step 2: Commit**
```bash
git add src/renderer/components/BlockItem.tsx
git commit -m "fix(security): disable spellCheck on unlocked encrypted block textarea"
```
