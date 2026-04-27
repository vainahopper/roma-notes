/**
 * Post-dist script: runs after electron-builder creates the DMG.
 * Writes a latest.json to ~/Library/Application Support/RomaNotes/
 * so the currently-installed app can detect the new version and
 * install it via "Check for Updates".
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execSync } = require('child_process')

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'))
const version = pkg.version

const dmgPath = path.join(__dirname, 'release', 'Roma Notes.dmg')
const builtAppPath = path.join(__dirname, 'release', 'mac-arm64', 'Roma Notes.app')
const dataDir = path.join(os.homedir(), 'Library', 'Application Support', 'RomaNotes')
const latestPath = path.join(dataDir, 'latest.json')

if (!fs.existsSync(dmgPath)) {
  console.log('⚠ DMG not found at', dmgPath, '— skipping latest.json generation')
  process.exit(0)
}

// Ad-hoc sign the built .app so macOS Gatekeeper allows it to launch via `open`.
// Without this, the auto-update install step copies a Gatekeeper-rejected app
// into /Applications and the next launch fails silently.
if (fs.existsSync(builtAppPath)) {
  try {
    execSync(`xattr -cr "${builtAppPath}"`, { stdio: 'inherit' })
    execSync(`codesign --force --deep --sign - "${builtAppPath}"`, { stdio: 'inherit' })
    console.log('✅ ad-hoc signed the .app for Gatekeeper compatibility')
  } catch (err) {
    console.error('⚠ ad-hoc signing failed:', err.message)
  }
}

// Ensure data dir exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const manifest = {
  version,
  notes: `Roma Notes ${version} is ready to install.`,
  dmgPath,
}

fs.writeFileSync(latestPath, JSON.stringify(manifest, null, 2))
console.log(`✅ latest.json written → ${latestPath}`)
console.log(`   version: ${version}`)
console.log(`   dmgPath: ${dmgPath}`)
console.log('')
console.log('The installed app will detect this update on next launch or via')
console.log('"Roma Notes > Check for Updates…"')
