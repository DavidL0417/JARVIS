import { readdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const turbopackCacheDir = path.join(root, ".next", "dev", "cache", "turbopack")
const cloudConflictName = /^(?:\d{8} \d+\.(?:sst|meta|del)|(?:CURRENT|LOG) \d+)$/

async function findCloudConflictFiles(dir, baseDir = dir) {
  let entries

  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === "ENOENT") {
      return []
    }

    throw error
  }

  const conflicts = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      conflicts.push(...await findCloudConflictFiles(fullPath, baseDir))
      continue
    }

    if (entry.isFile() && cloudConflictName.test(entry.name)) {
      conflicts.push(path.relative(baseDir, fullPath))
    }
  }

  return conflicts
}

const conflicts = await findCloudConflictFiles(turbopackCacheDir)

if (conflicts.length > 0) {
  await rm(turbopackCacheDir, { recursive: true, force: true })
  const examples = conflicts.slice(0, 3).join(", ")
  const suffix = conflicts.length > 3 ? `, and ${conflicts.length - 3} more` : ""

  console.warn(
    `[predev] Cleared .next/dev/cache/turbopack after detecting cloud-conflict database files: ${examples}${suffix}.`,
  )
}
