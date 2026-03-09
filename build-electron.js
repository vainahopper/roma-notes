const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// Ensure dist-electron directory exists
if (!fs.existsSync('dist-electron')) {
  fs.mkdirSync('dist-electron', { recursive: true })
}

// Copy main process files
fs.copyFileSync(path.join('src', 'main', 'index.js'), path.join('dist-electron', 'main.js'))
fs.copyFileSync(path.join('src', 'main', 'preload.js'), path.join('dist-electron', 'preload.js'))

// Compile Touch ID helper (Swift → binary)
try {
  execSync(
    `swiftc "${path.join('src', 'main', 'touchid.swift')}" -o "${path.join('dist-electron', 'touchid-helper')}"`,
    { stdio: 'pipe' }
  )
  console.log('Touch ID helper compiled successfully')
} catch (err) {
  console.warn('Could not compile Touch ID helper (Touch ID will be unavailable):', err.message)
}

console.log('Electron main process built successfully')
