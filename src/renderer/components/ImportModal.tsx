import React, { useState } from 'react'
import { importFromRoamFiles, importFromRoamJson, deduplicatePages } from '../utils/roamImporter'
import { importPages } from '../stores/useStore'
import { platform } from '../platform'
import './ImportModal.css'

interface Props {
  onClose: () => void
}

type Step = 'choose' | 'importing' | 'done' | 'error'

export function ImportModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('choose')
  const [importedCount, setImportedCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [progress, setProgress] = useState(0)

  async function handleImportZip() {
    const filePath = await platform.importSelectFile()
    if (!filePath) return

    setStep('importing')
    setProgress(10)

    try {
      const files = await platform.importReadZip(filePath)

      if (files.error) {
        throw new Error(files.error)
      }

      setProgress(40)

      // Check if zip contains JSON files (Roam JSON export inside zip)
      const jsonFiles = files.filter((f: any) => f.name.endsWith('.json'))
      const mdFiles = files.filter((f: any) => f.name.endsWith('.md'))

      let pages
      if (jsonFiles.length > 0 && mdFiles.length === 0) {
        // Pure JSON export
        const combined = jsonFiles.map((f: any) => f.content).join('')
        pages = importFromRoamJson(combined)
      } else {
        pages = importFromRoamFiles(mdFiles.length > 0 ? mdFiles : files)
      }

      setProgress(70)

      const deduped = deduplicatePages(pages)
      setProgress(90)

      importPages(deduped)
      setProgress(100)
      setImportedCount(deduped.length)
      setStep('done')
    } catch (err: any) {
      setErrorMsg(err.message || 'Import failed')
      setStep('error')
    }
  }

  async function handleImportFolder() {
    const folderPath = await platform.importSelectFolder()
    if (!folderPath) return

    setStep('importing')
    setProgress(10)

    try {
      const files = await platform.importReadFolder(folderPath)
      setProgress(40)

      const pages = importFromRoamFiles(files)
      setProgress(70)

      const deduped = deduplicatePages(pages)
      setProgress(90)

      importPages(deduped)
      setProgress(100)
      setImportedCount(deduped.length)
      setStep('done')
    } catch (err: any) {
      setErrorMsg(err.message || 'Import failed')
      setStep('error')
    }
  }

  async function handleImportJson() {
    const filePath = await platform.importSelectFile()
    if (!filePath) return

    setStep('importing')
    setProgress(10)

    try {
      const content = await platform.importReadFile(filePath)
      setProgress(40)

      const pages = importFromRoamJson(content)
      setProgress(70)

      const deduped = deduplicatePages(pages)
      setProgress(90)

      importPages(deduped)
      setProgress(100)
      setImportedCount(deduped.length)
      setStep('done')
    } catch (err: any) {
      setErrorMsg(err.message || 'Import failed')
      setStep('error')
    }
  }

  return (
    <div className="import-overlay" onClick={e => { if (e.target === e.currentTarget && step !== 'importing') onClose() }}>
      <div className="import-modal">
        <div className="import-header">
          <h2>Import from Roam Research</h2>
          {step !== 'importing' && (
            <button className="close-btn" onClick={onClose}>×</button>
          )}
        </div>

        {step === 'choose' && (
          <>
            <p className="import-description">
              Import your Roam Research export. The JSON format preserves block creation and edit timestamps.
            </p>

            <div className="import-options">
              <button className="import-option" onClick={handleImportJson}>
                <div className="option-icon">📋</div>
                <div className="option-text">
                  <strong>Import JSON file</strong>
                  <span>Roam JSON export — preserves timestamps ✓</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 8H12M12 8L9 5M12 8L9 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>

              <button className="import-option" onClick={handleImportZip}>
                <div className="option-icon">📦</div>
                <div className="option-text">
                  <strong>Import ZIP file</strong>
                  <span>Supports .zip with markdown or JSON files</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 8H12M12 8L9 5M12 8L9 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>

              <button className="import-option" onClick={handleImportFolder}>
                <div className="option-icon">📁</div>
                <div className="option-text">
                  <strong>Import markdown folder</strong>
                  <span>Folder with .md files (no timestamps)</span>
                </div>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M4 8H12M12 8L9 5M12 8L9 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            <div className="import-note">
              <strong>Note:</strong> Existing pages with the same title will be kept if they have more content.
              All your current notes are preserved.
            </div>
          </>
        )}

        {step === 'importing' && (
          <div className="importing-state">
            <div className="import-progress-bar">
              <div className="import-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p>Importing your notes… {progress}%</p>
            <p className="import-sub">This may take a moment for large exports.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="import-done">
            <div className="done-icon">✓</div>
            <h3>Import complete!</h3>
            <p>Successfully imported <strong>{importedCount}</strong> pages.</p>
            <button className="done-btn" onClick={onClose}>Done</button>
          </div>
        )}

        {step === 'error' && (
          <div className="import-error">
            <div className="error-icon">⚠️</div>
            <h3>Import failed</h3>
            <p>{errorMsg}</p>
            <div className="import-error-actions">
              <button className="modal-btn secondary" onClick={() => setStep('choose')}>Try again</button>
              <button className="modal-btn primary" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
