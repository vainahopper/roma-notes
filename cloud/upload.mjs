// Uploads local Mac pages to the cloud bridge. Usage: node upload.mjs <base-url> [days]
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const [base, days] = process.argv.slice(2)
const dir = path.join(os.homedir(), 'Library', 'Application Support', 'RomaNotes', 'pages')
const since = days ? Date.now() - Number(days) * 864e5 : 0

const pages = []
for (const f of await fs.readdir(dir)) {
  if (!f.endsWith('.json')) continue
  const p = JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8'))
  if (Date.parse(p.updatedAt) >= since) pages.push(p)
}
console.log(`Uploading ${pages.length} pages…`)
for (let i = 0; i < pages.length; i += 100) {
  const res = await fetch(`${base}/sync/pages`, { method: 'POST', body: JSON.stringify(pages.slice(i, i + 100)) })
  console.log(i, res.status, await res.text())
}
