// Web e2e scenario: the workspace-scoped Files panel. A cold-seeded session
// (zero model calls) opens in the real assembled app; the Files view tab
// lists the session cwd's real files, opens one in the bounded editor, and
// the panel is snapshotted as stable ARIA. The seed ends in turn/end so the
// session is real and openable; the fixture carries no model traffic.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession,
  watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/files-panel', import.meta.url))
const PANEL_EXPECTED = join(SNAPSHOT_DIR, 'panel.expected.md')
const MODE = webSnapshotMode()
const SESSION_ID = 'files-panel-web-e2e'
const WORKSPACE_NAME = 'files-workspace'
const DONE = 'FILES_PANEL_DONE'

/** The workspace subdirectory's real file tree (the panel must show these). */
const FILES = [
  'README.md',
  'src/main.ts',
  'src/util.ts',
  'notes.txt',
  '.gitignore',
] as const

/** One minimal closed turn so the session is real and openable. */
function sessionFixture(): string {
  const session = Session.create(SessionId('files-panel-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Set up the project files.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Files panel seed', messageSeqs: [user.seq], source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [{ type: 'text', text: `Project files are ready.\n\n${DONE}` }],
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({
      type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}',
      createdAt: 0, cwd: '{{cwd}}',
    }),
    ...session.events.map(event => JSON.stringify({
      ...event, time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

describe('web e2e: the workspace Files panel over a seeded session', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    // The session cwd is the scaffold workspace root; the panel lists that
    // root, so the fixture tree lives in a workspace subdirectory the test
    // navigates into (exercising the breadcrumb chrome).
    await mkdir(SNAPSHOT_DIR, { recursive: true })
    const cwd = join(scaffold.workspaceCwd, WORKSPACE_NAME)
    await mkdir(join(cwd, 'src'), { recursive: true })
    for (const path of FILES) {
      await writeFile(join(cwd, path), `content of ${path}\n`)
    }
    await seedSession(scaffold, sessionFixture(), SESSION_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the session workspace, opens a file, and snapshots the panel', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-files-panel'))
    // The seeded session row: expand the workspace group, then open the
    // session (the row's label is the workspace name plus its age; the title
    // projection only resolves once the session opens).
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 30_000 })
    if (await groupRow.getAttribute('aria-expanded') !== 'true') await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()

    // The turn tail confirms the session opened (the DONE marker is in the log).
    await page.getByText(DONE, { exact: true }).waitFor({ timeout: 30_000 })

    // Switch to the Files view tab.
    const filesTab = page.getByRole('tab', { name: 'Files', exact: true })
    await filesTab.waitFor({ timeout: 15_000 })
    await filesTab.click()

    // The workspace root lists the seeded subdirectory.
    const workspaceDir = page.getByText(`${WORKSPACE_NAME}/`, { exact: true })
    await workspaceDir.waitFor({ timeout: 15_000 })
    await workspaceDir.click()

    // The subdirectory lists every seeded entry, dirs and files alike.
    await page.getByText('README.md', { exact: true }).waitFor({ timeout: 15_000 })
    expect(await page.getByText('src/', { exact: true }).count()).toBe(1)
    expect(await page.getByText('.gitignore', { exact: true }).count()).toBe(1)
    expect(await page.getByText('notes.txt', { exact: true }).count()).toBe(1)

    // Open a file: the editor shows its bounded content.
    const panel = page.locator('[aria-label="Files panel"]')
    await panel.getByText('README.md', { exact: true }).click()
    const editor = panel.getByRole('textbox')
    await editor.waitFor({ timeout: 15_000 })
    expect(await editor.inputValue()).toBe('content of README.md\n')

    // Close the editor; the listing returns and the stable panel snapshot
    // covers the list chrome (root crumb, breadcrumbs, refresh, upload).
    await panel.getByRole('button', { name: 'Close', exact: true }).click()
    await panel.getByText('README.md', { exact: true }).waitFor({ timeout: 15_000 })
    const snapshot = await captureStableAria(page, '[aria-label="Files panel"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(PANEL_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 90_000)
})
