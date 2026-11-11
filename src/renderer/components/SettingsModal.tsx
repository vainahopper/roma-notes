import React, { useEffect } from 'react'
import './SettingsModal.css'

export type UiStyle = 'roma' | 'roam'
type ThemeMode = 'dark' | 'light' | 'system'

interface Props {
  themeMode: ThemeMode
  uiStyle: UiStyle
  onChangeTheme: (mode: ThemeMode) => void
  onChangeStyle: (style: UiStyle) => void
  onClose: () => void
}

const STYLES: { id: UiStyle; name: string; desc: string }[] = [
  { id: 'roma', name: 'Roma', desc: 'macOS glass, indigo accents, generous spacing' },
  { id: 'roam', name: 'Roam', desc: 'Roam Research feel — crisp, compact, blue links' },
]

const THEMES: { id: ThemeMode; name: string }[] = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'system', name: 'System' },
]

export function SettingsModal({ themeMode, uiStyle, onChangeTheme, onChangeStyle, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-overlay" onMouseDown={onClose}>
      <div className="settings-modal" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Settings">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose} title="Close">×</button>
        </div>

        <div className="settings-section">
          <div className="settings-label">Style</div>
          <div className="settings-style-grid">
            {STYLES.map(s => (
              <button
                key={s.id}
                className={`settings-style-card ${uiStyle === s.id ? 'selected' : ''}`}
                onClick={() => onChangeStyle(s.id)}
              >
                <div className={`style-preview style-preview-${s.id}`}>
                  <div className="sp-sidebar"><i /><i /><i /></div>
                  <div className="sp-main">
                    <b />
                    <span><em />line with <u>link</u></span>
                    <span className="sp-indent"><em />nested</span>
                  </div>
                </div>
                <div className="style-card-name">{s.name}</div>
                <div className="style-card-desc">{s.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">Appearance</div>
          <div className="settings-segmented">
            {THEMES.map(t => (
              <button
                key={t.id}
                className={themeMode === t.id ? 'selected' : ''}
                onClick={() => onChangeTheme(t.id)}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
