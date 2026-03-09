import type { PlatformAdapter } from './adapter'
import { createElectronAdapter } from './electron'
import { createCapacitorAdapter } from './capacitor'

function detectPlatform(): 'electron' | 'capacitor' {
  // Electron exposes window.api via preload bridge
  if (typeof window !== 'undefined' && (window as any).api) {
    return 'electron'
  }
  // Capacitor exposes window.Capacitor
  if (typeof window !== 'undefined' && (window as any).Capacitor) {
    return 'capacitor'
  }
  // Default to capacitor (web context without Electron)
  return 'capacitor'
}

let _platform: PlatformAdapter | null = null

export function getPlatform(): PlatformAdapter {
  if (!_platform) {
    const type = detectPlatform()
    _platform = type === 'electron'
      ? createElectronAdapter()
      : createCapacitorAdapter()
  }
  return _platform
}

/** Shortcut — import this for direct usage */
export const platform = new Proxy({} as PlatformAdapter, {
  get(_target, prop) {
    return (getPlatform() as any)[prop]
  }
})
