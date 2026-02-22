import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Browser, KeyInput, Page } from 'puppeteer-core';
import { connect } from 'puppeteer-core';
import { Launcher, launch, type LaunchedChrome } from 'chrome-launcher';

import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import { resolveContextDir } from '../store/paths.js';

type BrowserSlot = {
  contextKeyHash: string;
  chrome: LaunchedChrome;
  browser: Browser;
  pages: Map<number, Page>;
  selectedPageId: number | null;
  nextPageId: number;
  headless: boolean;
};

export type PageSummary = {
  id: number;
  url: string;
  title: string;
  selected: boolean;
};

export type SlotRuntimeState = {
  contextKeyHash: string;
  chromePid: number;
  debugPort: number;
  pageCount: number;
  selectedPageId: number | null;
  headless: boolean;
};

const DEFAULT_TIMEOUT_MS = 30_000;

const selectorSuggestions = (selector: string): string[] => [
  `Run: cdt capture snapshot --output json and verify selector ${selector}`,
  'Use a valid CSS selector via --uid'
];

const toTimeout = (timeoutMs?: number): number => {
  if (!timeoutMs || Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return timeoutMs;
};

export class BrowserSlotManager {
  private readonly slots = new Map<string, BrowserSlot>();

  public constructor(private readonly homeDir: string) {}

  public async startSession(
    contextKeyHash: string,
    options: {
      headless: boolean;
    }
  ): Promise<{ reused: boolean; state: SlotRuntimeState }> {
    const existing = this.slots.get(contextKeyHash);
    if (existing && existing.browser.connected) {
      return {
        reused: true,
        state: this.getSlotState(existing)
      };
    }

    const slot = await this.launchSlot(contextKeyHash, options.headless);
    this.slots.set(contextKeyHash, slot);

    return {
      reused: false,
      state: this.getSlotState(slot)
    };
  }

  public async stopSession(contextKeyHash: string): Promise<boolean> {
    const slot = this.slots.get(contextKeyHash);
    if (!slot) {
      return false;
    }

    await this.closeSlot(slot);
    this.slots.delete(contextKeyHash);
    return true;
  }

  public getRuntimeState(contextKeyHash: string): SlotRuntimeState | null {
    const slot = this.slots.get(contextKeyHash);
    if (!slot) {
      return null;
    }

    return this.getSlotState(slot);
  }

  public async listPages(contextKeyHash: string): Promise<{ pages: PageSummary[]; selectedPageId: number | null }> {
    const slot = this.ensureSlot(contextKeyHash);
    await this.reconcileClosedPages(slot);

    return {
      pages: await this.collectPageSummaries(slot),
      selectedPageId: slot.selectedPageId
    };
  }

  public async openPage(
    contextKeyHash: string,
    input: { url?: string; timeoutMs?: number }
  ): Promise<{ page: PageSummary; pages: PageSummary[] }> {
    const slot = this.ensureSlot(contextKeyHash);
    const page = await slot.browser.newPage();
    const pageId = this.registerPage(slot, page);

    if (input.url) {
      await page.goto(input.url, {
        waitUntil: 'domcontentloaded',
        timeout: toTimeout(input.timeoutMs)
      });
    }

    slot.selectedPageId = pageId;

    return {
      page: await this.toPageSummary(slot, pageId, page),
      pages: await this.collectPageSummaries(slot)
    };
  }

  public async usePage(contextKeyHash: string, pageId: number): Promise<{ page: PageSummary }> {
    const slot = this.ensureSlot(contextKeyHash);
    await this.reconcileClosedPages(slot);

    const page = slot.pages.get(pageId);
    if (!page || page.isClosed()) {
      throw new AppError(`Page ${pageId} does not exist in current context.`, {
        code: ERROR_CODE.PAGE_NOT_FOUND,
        details: { pageId, contextKeyHash },
        suggestions: ['Run: cdt page list --output json', 'Then choose an existing page id with cdt page use --page <id>']
      });
    }

    slot.selectedPageId = pageId;

    return {
      page: await this.toPageSummary(slot, pageId, page)
    };
  }

  public async navigatePage(
    contextKeyHash: string,
    input: { pageId?: number; url: string; timeoutMs?: number }
  ): Promise<{ page: PageSummary }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.goto(input.url, {
      waitUntil: 'domcontentloaded',
      timeout: toTimeout(input.timeoutMs)
    });

    slot.selectedPageId = pageId;

    return {
      page: await this.toPageSummary(slot, pageId, page)
    };
  }

  public async waitText(
    contextKeyHash: string,
    input: { pageId?: number; text: string; timeoutMs?: number }
  ): Promise<{ matched: true; pageId: number; text: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    try {
      await page.waitForFunction(
        (needle) => {
          const documentRef = (globalThis as { document?: { body?: { innerText?: string } } }).document;
          const bodyText = documentRef?.body?.innerText ?? '';
          return bodyText.includes(needle);
        },
        { timeout: toTimeout(input.timeoutMs) },
        input.text
      );
    } catch (error) {
      throw new AppError(`Timed out waiting for text: ${input.text}`, {
        code: ERROR_CODE.TIMEOUT,
        details: {
          text: input.text,
          pageId,
          reason: error instanceof Error ? error.message : String(error)
        },
        suggestions: ['Increase timeout: --timeout <ms>', 'Verify target text is present on page.']
      });
    }

    return {
      matched: true,
      pageId,
      text: input.text
    };
  }

  public async evaluate(
    contextKeyHash: string,
    input: { pageId?: number; functionSource: string }
  ): Promise<{ pageId: number; value: unknown }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const value = await page.evaluate(async (source) => {
      const compiled = new Function(`return (${source});`)();
      if (typeof compiled === 'function') {
        return await compiled();
      }
      return compiled;
    }, input.functionSource);

    return {
      pageId,
      value
    };
  }

  public async fillElement(
    contextKeyHash: string,
    input: { pageId?: number; selector: string; value: string }
  ): Promise<{ pageId: number; selector: string; value: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const exists = await page.$(input.selector);
    if (!exists) {
      throw new AppError(`Element not found for selector: ${input.selector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector: input.selector, pageId },
        suggestions: selectorSuggestions(input.selector)
      });
    }

    const updated = await page.evaluate(
      (selector, value) => {
        const documentRef = (globalThis as { document?: { querySelector?: (s: string) => unknown } }).document;
        const node = documentRef?.querySelector?.(selector) as {
          value?: string;
          isContentEditable?: boolean;
          textContent?: string | null;
          dispatchEvent?: (event: unknown) => void;
        } | null;

        if (!node) {
          return false;
        }

        if (typeof node.value === 'string') {
          node.value = value;
        } else if (node.isContentEditable) {
          node.textContent = value;
        } else {
          return false;
        }

        const EventCtor = (globalThis as { Event?: new (type: string, init?: unknown) => unknown }).Event;
        if (EventCtor && node.dispatchEvent) {
          node.dispatchEvent(new EventCtor('input', { bubbles: true }));
          node.dispatchEvent(new EventCtor('change', { bubbles: true }));
        }

        return true;
      },
      input.selector,
      input.value
    );

    if (!updated) {
      throw new AppError(`Element cannot be filled: ${input.selector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector: input.selector, pageId },
        suggestions: ['Target an input/textarea/contenteditable element.', 'Run: cdt capture snapshot --output json']
      });
    }

    return {
      pageId,
      selector: input.selector,
      value: input.value
    };
  }

  public async clickElement(
    contextKeyHash: string,
    input: { pageId?: number; selector: string; timeoutMs?: number }
  ): Promise<{ pageId: number; selector: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    try {
      await page.waitForSelector(input.selector, { timeout: toTimeout(input.timeoutMs) });
      await page.click(input.selector);
    } catch {
      throw new AppError(`Element not found for selector: ${input.selector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector: input.selector, pageId },
        suggestions: selectorSuggestions(input.selector)
      });
    }

    return {
      pageId,
      selector: input.selector
    };
  }

  public async pressKey(
    contextKeyHash: string,
    input: { pageId?: number; key: string }
  ): Promise<{ pageId: number; key: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.keyboard.press(input.key as KeyInput);

    return {
      pageId,
      key: input.key
    };
  }

  public async snapshot(contextKeyHash: string, input: { pageId?: number }): Promise<{
    page: PageSummary;
    snapshot: {
      html: string;
      length: number;
    };
  }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const html = await page.content();

    return {
      page: await this.toPageSummary(slot, pageId, page),
      snapshot: {
        html,
        length: html.length
      }
    };
  }

  public async closeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.slots.values()).map(async (slot) => {
        await this.closeSlot(slot);
      })
    );
    this.slots.clear();
  }

  public static resolveChromePath(): string | null {
    const fromEnv = process.env.CDT_CHROME_PATH?.trim();
    if (fromEnv) {
      return fromEnv;
    }

    return Launcher.getFirstInstallation() ?? null;
  }

  private ensureSlot(contextKeyHash: string): BrowserSlot {
    const slot = this.slots.get(contextKeyHash);
    if (!slot || !slot.browser.connected) {
      throw new AppError('Session is not running for this context.', {
        code: ERROR_CODE.SESSION_NOT_FOUND,
        details: { contextKeyHash },
        suggestions: ['Run: cdt session start --output json']
      });
    }

    return slot;
  }

  private async launchSlot(contextKeyHash: string, headless: boolean): Promise<BrowserSlot> {
    const chromePath = BrowserSlotManager.resolveChromePath();
    if (!chromePath) {
      throw new AppError('Chrome executable was not found.', {
        code: ERROR_CODE.BROWSER_LAUNCH_FAILED,
        suggestions: ['Install Google Chrome/Chromium.', 'Or set CDT_CHROME_PATH to a valid browser binary.']
      });
    }

    const profileDir = path.join(resolveContextDir(contextKeyHash, this.homeDir), 'chrome-profile');
    await mkdir(profileDir, { recursive: true });

    const chrome = await launch({
      chromePath,
      port: 0,
      userDataDir: profileDir,
      chromeFlags: headless ? ['--headless=new'] : []
    });

    const browser = await connect({
      browserURL: `http://127.0.0.1:${chrome.port}`,
      defaultViewport: null
    });

    const slot: BrowserSlot = {
      contextKeyHash,
      chrome,
      browser,
      pages: new Map<number, Page>(),
      selectedPageId: null,
      nextPageId: 1,
      headless
    };

    const initialPages = await browser.pages();
    if (initialPages.length === 0) {
      const initial = await browser.newPage();
      this.registerPage(slot, initial);
    } else {
      for (const page of initialPages) {
        this.registerPage(slot, page);
      }
    }

    return slot;
  }

  private registerPage(slot: BrowserSlot, page: Page): number {
    for (const [existingId, existingPage] of slot.pages.entries()) {
      if (existingPage === page) {
        return existingId;
      }
    }

    const id = slot.nextPageId;
    slot.nextPageId += 1;
    slot.pages.set(id, page);

    if (slot.selectedPageId === null) {
      slot.selectedPageId = id;
    }

    page.once('close', () => {
      slot.pages.delete(id);
      if (slot.selectedPageId === id) {
        const first = slot.pages.keys().next();
        slot.selectedPageId = first.done ? null : first.value;
      }
    });

    return id;
  }

  private async reconcileClosedPages(slot: BrowserSlot): Promise<void> {
    for (const [id, page] of slot.pages.entries()) {
      if (page.isClosed()) {
        slot.pages.delete(id);
      }
    }

    if (!slot.selectedPageId || !slot.pages.has(slot.selectedPageId)) {
      const first = slot.pages.keys().next();
      slot.selectedPageId = first.done ? null : first.value;
    }

    if (slot.pages.size === 0) {
      const page = await slot.browser.newPage();
      const id = this.registerPage(slot, page);
      slot.selectedPageId = id;
    }
  }

  private resolvePage(slot: BrowserSlot, requestedId?: number): { pageId: number; page: Page } {
    const pageId = requestedId ?? slot.selectedPageId;
    if (!pageId) {
      throw new AppError('No selected page in current context.', {
        code: ERROR_CODE.PAGE_NOT_FOUND,
        details: { contextKeyHash: slot.contextKeyHash },
        suggestions: ['Run: cdt page open --url https://example.com', 'Or select one with cdt page use --page <id>']
      });
    }

    const page = slot.pages.get(pageId);
    if (!page || page.isClosed()) {
      throw new AppError(`Page ${pageId} does not exist in current context.`, {
        code: ERROR_CODE.PAGE_NOT_FOUND,
        details: { contextKeyHash: slot.contextKeyHash, pageId },
        suggestions: ['Run: cdt page list --output json', 'Then select a valid page with cdt page use --page <id>']
      });
    }

    return { pageId, page };
  }

  private async collectPageSummaries(slot: BrowserSlot): Promise<PageSummary[]> {
    const summaries = await Promise.all(
      Array.from(slot.pages.entries()).map(async ([id, page]) => this.toPageSummary(slot, id, page))
    );

    return summaries.sort((a, b) => a.id - b.id);
  }

  private async toPageSummary(slot: BrowserSlot, id: number, page: Page): Promise<PageSummary> {
    const title = await page.title().catch(() => '');

    return {
      id,
      url: page.url(),
      title,
      selected: slot.selectedPageId === id
    };
  }

  private getSlotState(slot: BrowserSlot): SlotRuntimeState {
    return {
      contextKeyHash: slot.contextKeyHash,
      chromePid: slot.chrome.pid,
      debugPort: slot.chrome.port,
      pageCount: slot.pages.size,
      selectedPageId: slot.selectedPageId,
      headless: slot.headless
    };
  }

  private async closeSlot(slot: BrowserSlot): Promise<void> {
    try {
      await slot.browser.close();
    } catch {
      // ignore close failure and force kill chrome process below
    }

    try {
      slot.chrome.kill();
    } catch {
      // ignore kill failure during cleanup
    }
  }
}
