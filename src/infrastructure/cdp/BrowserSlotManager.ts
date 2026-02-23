import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Launcher, launch, type LaunchedChrome } from 'chrome-launcher';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type CDPSession,
  type Dialog,
  type Geolocation,
  type Page,
  type Request as PWRequest
} from 'playwright';

import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import { resolveContextDir } from '../store/paths.js';

type MouseButton = 'left' | 'right' | 'middle';
type ConsoleMessageType = string;
type Viewport = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  isLandscape?: boolean;
};
type GeolocationOptions = Geolocation;
type NetworkConditions = {
  download: number;
  upload: number;
  latency: number;
};

type ConsoleEntry = {
  id: number;
  pageId: number;
  type: ConsoleMessageType;
  text: string;
  location: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  createdAt: string;
};

type NetworkEntry = {
  id: number;
  pageId: number;
  url: string;
  method: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  status: number | null;
  statusText: string | null;
  ok: boolean | null;
  responseHeaders: Record<string, string>;
  responseBody: string | null;
  failureText: string | null;
  createdAt: string;
  updatedAt: string;
};

type EmulationState = {
  viewport: Viewport | null;
  userAgent: string | null;
  networkConditions: NetworkConditions | null;
  geolocation: GeolocationOptions | null;
};

type TraceState = {
  pageId: number;
  filePath: string;
  startedAt: string;
  session: CDPSession;
  events: Array<Record<string, unknown>>;
  onDataCollected: (payload: { value?: Array<Record<string, unknown>> }) => void;
  onTracingComplete: () => void;
  completion: Promise<void>;
};

type UrlPatternMatcher = {
  source: string;
  mode: 'substring' | 'regex';
  regex?: RegExp;
};

type BrowserSlot = {
  contextKeyHash: string;
  chrome: LaunchedChrome;
  browser: Browser;
  context: BrowserContext;
  pages: Map<number, Page>;
  pageCdpSessions: Map<number, CDPSession>;
  selectedPageId: number | null;
  nextPageId: number;
  headless: boolean;
  defaultUserAgent: string;
  consoleEntries: ConsoleEntry[];
  nextConsoleId: number;
  networkEntries: NetworkEntry[];
  requestToNetworkId: WeakMap<PWRequest, number>;
  nextNetworkId: number;
  pendingDialogs: Map<number, Dialog>;
  emulation: EmulationState;
  trace: TraceState | null;
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
const SCREENSHOT_KEEP_DEFAULT = 300;
const NETWORK_PROFILE_TABLE: Record<string, NetworkConditions> = {
  'Slow 3G': {
    download: 50_000,
    upload: 50_000,
    latency: 2_000
  },
  'Fast 3G': {
    download: 180_000,
    upload: 84_375,
    latency: 562.5
  },
  'Slow 4G': {
    download: 180_000,
    upload: 84_375,
    latency: 562.5
  },
  'Fast 4G': {
    download: 1_012_500,
    upload: 168_750,
    latency: 165
  }
};

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

const toRequestHeaders = (headers: Record<string, string>): Record<string, string> => {
  return Object.fromEntries(Object.entries(headers));
};

const toResponseHeaders = (headers: Record<string, string | string[]>): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  return normalized;
};

const toOptionalString = (input: string | undefined | null): string | null => {
  if (!input) {
    return null;
  }
  return input;
};

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parsePattern = (source: string): UrlPatternMatcher => {
  if (source.length >= 2 && source.startsWith('/') && source.lastIndexOf('/') > 0) {
    const idx = source.lastIndexOf('/');
    const body = source.slice(1, idx);
    const flags = source.slice(idx + 1);
    try {
      return {
        source,
        mode: 'regex',
        regex: new RegExp(body, flags)
      };
    } catch {
      // Fall back to substring matching when regex parse fails.
    }
  }

  return {
    source,
    mode: 'substring'
  };
};

const matchesPattern = (matcher: UrlPatternMatcher, value: string): boolean => {
  if (matcher.mode === 'regex' && matcher.regex) {
    return matcher.regex.test(value);
  }
  return value.includes(matcher.source);
};

const sanitizeLabel = (label?: string): string => {
  const fallback = 'capture';
  if (!label) {
    return fallback;
  }
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized.length > 0 ? normalized : fallback;
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
    if (existing && existing.browser.isConnected()) {
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
    const page = await slot.context.newPage();
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

  public async closePage(
    contextKeyHash: string,
    input: { pageId?: number }
  ): Promise<{ closedPageId: number; pages: PageSummary[]; selectedPageId: number | null }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.close();
    await this.reconcileClosedPages(slot);

    return {
      closedPageId: pageId,
      pages: await this.collectPageSummaries(slot),
      selectedPageId: slot.selectedPageId
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

    await page.bringToFront();
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

  public async resizePage(
    contextKeyHash: string,
    input: { pageId?: number; width: number; height: number }
  ): Promise<{ pageId: number; viewport: { width: number; height: number } }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.setViewportSize({
      width: input.width,
      height: input.height
    });

    return {
      pageId,
      viewport: {
        width: input.width,
        height: input.height
      }
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
        (needle: string) => {
          const documentRef = (globalThis as { document?: { body?: { innerText?: string } } }).document;
          const bodyText = documentRef?.body?.innerText ?? '';
          return bodyText.includes(needle);
        },
        input.text,
        { timeout: toTimeout(input.timeoutMs) }
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

  public async waitSelector(
    contextKeyHash: string,
    input: { pageId?: number; selector: string; timeoutMs?: number }
  ): Promise<{ matched: true; pageId: number; selector: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    try {
      await page.waitForSelector(input.selector, {
        timeout: toTimeout(input.timeoutMs)
      });
    } catch (error) {
      throw new AppError(`Timed out waiting for selector: ${input.selector}`, {
        code: ERROR_CODE.TIMEOUT,
        details: {
          selector: input.selector,
          pageId,
          reason: error instanceof Error ? error.message : String(error)
        },
        suggestions: ['Increase timeout: --timeout <ms>', ...selectorSuggestions(input.selector)]
      });
    }

    return {
      matched: true,
      pageId,
      selector: input.selector
    };
  }

  public async waitUrl(
    contextKeyHash: string,
    input: { pageId?: number; pattern: string; timeoutMs?: number }
  ): Promise<{ matched: true; pageId: number; url: string; pattern: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);
    const matcher = parsePattern(input.pattern);

    const deadline = Date.now() + toTimeout(input.timeoutMs);
    while (Date.now() < deadline) {
      const url = page.url();
      if (matchesPattern(matcher, url)) {
        return {
          matched: true,
          pageId,
          url,
          pattern: input.pattern
        };
      }
      await sleep(100);
    }

    throw new AppError(`Timed out waiting for URL pattern: ${input.pattern}`, {
      code: ERROR_CODE.TIMEOUT,
      details: {
        pageId,
        pattern: input.pattern,
        url: page.url()
      },
      suggestions: ['Increase timeout: --timeout <ms>', 'Verify page navigation logic or expected URL pattern.']
    });
  }

  public async observeState(
    contextKeyHash: string,
    input: { pageId?: number }
  ): Promise<{
    page: PageSummary;
    state: {
      viewport: { width: number; height: number };
      scroll: { x: number; y: number };
      activeElement: {
        tag: string | null;
        id: string | null;
        name: string | null;
      };
      dialogOpen: boolean;
      capturedAt: string;
    };
  }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const observed = await page.evaluate(() => {
      const doc = (globalThis as { document?: { activeElement?: { tagName?: string; id?: string; getAttribute?: (name: string) => string | null } } }).document;
      const win = (globalThis as { window?: { innerWidth?: number; innerHeight?: number; scrollX?: number; scrollY?: number } }).window;
      const active = doc?.activeElement;

      return {
        viewport: {
          width: win?.innerWidth ?? 0,
          height: win?.innerHeight ?? 0
        },
        scroll: {
          x: win?.scrollX ?? 0,
          y: win?.scrollY ?? 0
        },
        activeElement: {
          tag: active?.tagName ? active.tagName.toLowerCase() : null,
          id: active?.id ?? null,
          name: active?.getAttribute?.('name') ?? null
        }
      };
    });

    return {
      page: await this.toPageSummary(slot, pageId, page),
      state: {
        viewport: observed.viewport,
        scroll: observed.scroll,
        activeElement: observed.activeElement,
        dialogOpen: slot.pendingDialogs.has(pageId),
        capturedAt: new Date().toISOString()
      }
    };
  }

  public async observeTargets(
    contextKeyHash: string,
    input: { pageId?: number; limit?: number; onlyVisible?: boolean }
  ): Promise<{
    page: PageSummary;
    targets: Array<{
      id: string;
      tag: string;
      role: string | null;
      text: string;
      selectorCandidates: string[];
      bbox: { x: number; y: number; width: number; height: number };
      visible: boolean;
      enabled: boolean;
      editable: boolean;
      inViewport: boolean;
    }>;
  }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);
    const limit = input.limit ?? 200;

    const targets = await page.evaluate(
      ({ capLimit, onlyVisible }) => {
        const doc = (globalThis as { document?: { querySelectorAll?: (selector: string) => ArrayLike<unknown> } }).document;
        const win = (globalThis as {
          window?: {
            getComputedStyle?: (el: unknown) => { display?: string; visibility?: string; opacity?: string };
            innerWidth?: number;
            innerHeight?: number;
          };
        }).window;

        const elements = Array.from(
          doc?.querySelectorAll?.(
            'a,button,input,textarea,select,[role="button"],[role="link"],[role="menuitem"],[contenteditable="true"],[tabindex]'
          ) ?? []
        ) as Array<{
          id?: string;
          className?: string;
          tagName?: string;
          textContent?: string | null;
          isContentEditable?: boolean;
          disabled?: boolean;
          getAttribute?: (name: string) => string | null;
          getBoundingClientRect?: () => { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
        }>;

        const out: Array<{
          id: string;
          tag: string;
          role: string | null;
          text: string;
          selectorCandidates: string[];
          bbox: { x: number; y: number; width: number; height: number };
          visible: boolean;
          enabled: boolean;
          editable: boolean;
          inViewport: boolean;
        }> = [];

        for (let index = 0; index < elements.length; index += 1) {
          const element = elements[index];
          const rect = element.getBoundingClientRect?.();
          if (!rect) {
            continue;
          }
          const style = win?.getComputedStyle?.(element) ?? {};
          const visible =
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0';
          const inViewport =
            rect.bottom > 0 &&
            rect.right > 0 &&
            rect.left < (win?.innerWidth ?? 0) &&
            rect.top < (win?.innerHeight ?? 0);

          if (onlyVisible && !visible) {
            continue;
          }

          const selectorCandidatesRaw: string[] = [];
          if (element.id) {
            selectorCandidatesRaw.push(`#${element.id.replace(/([\\[\\]#.:"'])/g, '\\$1')}`);
          }
          const testId = element.getAttribute?.('data-testid');
          if (testId) {
            selectorCandidatesRaw.push(`[data-testid="${testId.replace(/([\\[\\]#.:"'])/g, '\\$1')}"]`);
          }
          const name = element.getAttribute?.('name');
          if (name) {
            selectorCandidatesRaw.push(`[name="${name.replace(/([\\[\\]#.:"'])/g, '\\$1')}"]`);
          }
          const aria = element.getAttribute?.('aria-label');
          if (aria) {
            selectorCandidatesRaw.push(`[aria-label="${aria.replace(/([\\[\\]#.:"'])/g, '\\$1')}"]`);
          }
          const role = element.getAttribute?.('role');
          if (role) {
            selectorCandidatesRaw.push(`[role="${role.replace(/([\\[\\]#.:"'])/g, '\\$1')}"]`);
          }
          const classNames = (element.className || '')
            .toString()
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((className) => `.${className.replace(/([\\[\\]#.:"'])/g, '\\$1')}`)
            .join('');
          selectorCandidatesRaw.push(`${(element.tagName ?? 'div').toLowerCase()}${classNames}`);
          const selectorCandidates = Array.from(new Set(selectorCandidatesRaw));

          out.push({
            id: `t-${index + 1}`,
            tag: (element.tagName ?? 'div').toLowerCase(),
            role: element.getAttribute?.('role') ?? null,
            text: (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
            selectorCandidates,
            bbox: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            },
            visible,
            enabled: !element.disabled,
            editable: element.isContentEditable || element.tagName === 'INPUT' || element.tagName === 'TEXTAREA',
            inViewport
          });

          if (out.length >= capLimit) {
            break;
          }
        }

        return out;
      },
      { capLimit: limit, onlyVisible: input.onlyVisible === true }
    );

    return {
      page: await this.toPageSummary(slot, pageId, page),
      targets
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

    await this.fillElementOnPage(page, pageId, input.selector, input.value);

    return {
      pageId,
      selector: input.selector,
      value: input.value
    };
  }

  public async fillForm(
    contextKeyHash: string,
    input: { pageId?: number; entries: Array<{ selector: string; value: string }> }
  ): Promise<{ pageId: number; filled: Array<{ selector: string; value: string }> }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    for (const entry of input.entries) {
      await this.fillElementOnPage(page, pageId, entry.selector, entry.value);
    }

    return {
      pageId,
      filled: input.entries
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

  public async hoverElement(
    contextKeyHash: string,
    input: { pageId?: number; selector: string; timeoutMs?: number }
  ): Promise<{ pageId: number; selector: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    try {
      await page.waitForSelector(input.selector, { timeout: toTimeout(input.timeoutMs) });
      await page.hover(input.selector);
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

  public async dragElement(
    contextKeyHash: string,
    input: { pageId?: number; fromSelector: string; toSelector: string; steps?: number }
  ): Promise<{ pageId: number; fromSelector: string; toSelector: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const fromHandle = await page.$(input.fromSelector);
    const toHandle = await page.$(input.toSelector);

    if (!fromHandle) {
      throw new AppError(`Element not found for selector: ${input.fromSelector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector: input.fromSelector, pageId },
        suggestions: selectorSuggestions(input.fromSelector)
      });
    }

    if (!toHandle) {
      throw new AppError(`Element not found for selector: ${input.toSelector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector: input.toSelector, pageId },
        suggestions: selectorSuggestions(input.toSelector)
      });
    }

    const fromBox = await fromHandle.boundingBox();
    const toBox = await toHandle.boundingBox();

    if (!fromBox || !toBox) {
      throw new AppError('Unable to compute drag coordinates.', {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { pageId, fromSelector: input.fromSelector, toSelector: input.toSelector },
        suggestions: ['Ensure both elements are visible on screen.']
      });
    }

    const fromX = fromBox.x + fromBox.width / 2;
    const fromY = fromBox.y + fromBox.height / 2;
    const toX = toBox.x + toBox.width / 2;
    const toY = toBox.y + toBox.height / 2;

    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(toX, toY, {
      steps: input.steps ?? 16
    });
    await page.mouse.up();

    return {
      pageId,
      fromSelector: input.fromSelector,
      toSelector: input.toSelector
    };
  }

  public async uploadFile(
    contextKeyHash: string,
    input: { pageId?: number; selector: string; filePath: string }
  ): Promise<{ pageId: number; selector: string; filePath: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const elementHandle = await page.$(input.selector);
    if (!elementHandle) {
      throw new AppError(`Element not found for selector: ${input.selector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector: input.selector, pageId },
        suggestions: selectorSuggestions(input.selector)
      });
    }

    await elementHandle.setInputFiles(input.filePath);

    return {
      pageId,
      selector: input.selector,
      filePath: input.filePath
    };
  }

  public async pressKey(
    contextKeyHash: string,
    input: { pageId?: number; key: string }
  ): Promise<{ pageId: number; key: string }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.keyboard.press(input.key);

    return {
      pageId,
      key: input.key
    };
  }

  public async typeText(
    contextKeyHash: string,
    input: { pageId?: number; text: string; delayMs?: number }
  ): Promise<{ pageId: number; textLength: number; delayMs: number }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.keyboard.type(input.text, {
      delay: input.delayMs ?? 0
    });

    return {
      pageId,
      textLength: input.text.length,
      delayMs: input.delayMs ?? 0
    };
  }

  public async mouseMove(
    contextKeyHash: string,
    input: { pageId?: number; x: number; y: number; steps?: number }
  ): Promise<{ pageId: number; x: number; y: number; steps: number }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.bringToFront();
    await page.mouse.move(input.x, input.y, { steps: input.steps ?? 1 });

    return {
      pageId,
      x: input.x,
      y: input.y,
      steps: input.steps ?? 1
    };
  }

  public async mouseClick(
    contextKeyHash: string,
    input: {
      pageId?: number;
      x: number;
      y: number;
      button?: MouseButton;
      count?: number;
      delayMs?: number;
    }
  ): Promise<{ pageId: number; x: number; y: number; button: MouseButton; count: number }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);
    await this.assertPointInteractable(page, pageId, input.x, input.y);

    await page.bringToFront();
    await page.mouse.click(input.x, input.y, {
      button: input.button ?? 'left',
      clickCount: input.count ?? 1,
      delay: input.delayMs
    });

    return {
      pageId,
      x: input.x,
      y: input.y,
      button: input.button ?? 'left',
      count: input.count ?? 1
    };
  }

  public async mouseDown(
    contextKeyHash: string,
    input: { pageId?: number; button?: MouseButton; count?: number }
  ): Promise<{ pageId: number; button: MouseButton; count: number }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.bringToFront();
    await page.mouse.down({
      button: input.button ?? 'left',
      clickCount: input.count ?? 1
    });

    return {
      pageId,
      button: input.button ?? 'left',
      count: input.count ?? 1
    };
  }

  public async mouseUp(
    contextKeyHash: string,
    input: { pageId?: number; button?: MouseButton; count?: number }
  ): Promise<{ pageId: number; button: MouseButton; count: number }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await page.bringToFront();
    await page.mouse.up({
      button: input.button ?? 'left',
      clickCount: input.count ?? 1
    });

    return {
      pageId,
      button: input.button ?? 'left',
      count: input.count ?? 1
    };
  }

  public async mouseDrag(
    contextKeyHash: string,
    input: { pageId?: number; fromX: number; fromY: number; toX: number; toY: number; steps?: number; button?: MouseButton }
  ): Promise<{ pageId: number; fromX: number; fromY: number; toX: number; toY: number; steps: number }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    await this.assertPointInteractable(page, pageId, input.fromX, input.fromY);
    await this.assertPointInteractable(page, pageId, input.toX, input.toY);

    const steps = input.steps ?? 16;
    const button = input.button ?? 'left';

    await page.bringToFront();
    await page.mouse.move(input.fromX, input.fromY);
    await page.mouse.down({ button, clickCount: 1 });
    await page.mouse.move(input.toX, input.toY, { steps });
    await page.mouse.up({ button, clickCount: 1 });

    return {
      pageId,
      fromX: input.fromX,
      fromY: input.fromY,
      toX: input.toX,
      toY: input.toY,
      steps
    };
  }

  public async mouseScroll(
    contextKeyHash: string,
    input: { pageId?: number; dx?: number; dy: number }
  ): Promise<{ pageId: number; dx: number; dy: number; changed: boolean }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);
    const dx = input.dx ?? 0;

    await page.bringToFront();
    const before = await page.evaluate(() => {
      const win = (globalThis as { window?: { scrollX?: number; scrollY?: number } }).window;
      return { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 };
    });

    await page.mouse.wheel(dx, input.dy);

    const after = await page.evaluate(() => {
      const win = (globalThis as { window?: { scrollX?: number; scrollY?: number } }).window;
      return { x: win?.scrollX ?? 0, y: win?.scrollY ?? 0 };
    });

    const changed = before.x !== after.x || before.y !== after.y;
    if (!changed) {
      throw new AppError('Scroll action had no visible effect.', {
        code: ERROR_CODE.ACTION_NO_EFFECT,
        details: {
          pageId,
          before,
          after,
          dx,
          dy: input.dy
        },
        suggestions: ['Try larger wheel delta values.', 'Ensure the page has scrollable content.']
      });
    }

    return {
      pageId,
      dx,
      dy: input.dy,
      changed
    };
  }

  public async handleDialog(
    contextKeyHash: string,
    input: { pageId?: number; action: 'accept' | 'dismiss'; promptText?: string }
  ): Promise<{ pageId: number; action: 'accept' | 'dismiss' }> {
    const slot = this.ensureSlot(contextKeyHash);
    const pageId = input.pageId ?? slot.selectedPageId;

    if (!pageId) {
      throw new AppError('No selected page in current context.', {
        code: ERROR_CODE.PAGE_NOT_FOUND,
        suggestions: ['Run: cdt page list --output json']
      });
    }

    const dialog = slot.pendingDialogs.get(pageId);
    if (!dialog) {
      throw new AppError('No open dialog for this page.', {
        code: ERROR_CODE.DIALOG_NOT_OPEN,
        details: { pageId },
        suggestions: ['Trigger dialog first, then run: cdt dialog handle --action accept|dismiss']
      });
    }

    if (input.action === 'accept') {
      await dialog.accept(input.promptText);
    } else {
      await dialog.dismiss();
    }

    slot.pendingDialogs.delete(pageId);

    return {
      pageId,
      action: input.action
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

  public async snapshotAria(contextKeyHash: string, input: { pageId?: number }): Promise<{
    page: PageSummary;
    snapshot: {
      format: 'playwright-aria';
      raw: string;
      nodeCount: number;
      capturedAt: string;
    };
  }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const raw = await page.locator('html').ariaSnapshot();
    const nodeCount = raw
      .split('\n')
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith('- '))
      .length;

    return {
      page: await this.toPageSummary(slot, pageId, page),
      snapshot: {
        format: 'playwright-aria',
        raw,
        nodeCount,
        capturedAt: new Date().toISOString()
      }
    };
  }

  public async screenshot(
    contextKeyHash: string,
    input: {
      pageId?: number;
      filePath?: string;
      dirPath?: string;
      label?: string;
      fullPage?: boolean;
      format?: 'png' | 'jpeg' | 'webp';
      quality?: number;
      maxWidth?: number;
      maxHeight?: number;
      keep?: number;
    }
  ): Promise<{
    pageId: number;
    filePath: string;
    bytes: number;
    sha256: string;
    width: number | null;
    height: number | null;
    resized: boolean;
    capturedAt: string;
  }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);
    const format = input.format ?? 'png';
    const filePath = await this.resolveScreenshotPath(contextKeyHash, pageId, {
      filePath: input.filePath,
      dirPath: input.dirPath,
      label: input.label,
      format
    });
    const capturedAt = new Date().toISOString();

    const rawBuffer =
      format === 'webp'
        ? await this.captureWebpViaCdp(slot, pageId, page, {
            fullPage: input.fullPage,
            quality: input.quality
          })
        : await page.screenshot({
            fullPage: input.fullPage,
            type: format,
            quality: format === 'png' ? undefined : input.quality
          });

    const resized = await this.resizeScreenshotIfNeeded({
      format,
      source: rawBuffer,
      maxWidth: input.maxWidth,
      maxHeight: input.maxHeight
    });

    await writeFile(filePath, resized.buffer);

    if (!input.filePath) {
      await this.cleanupArtifacts(path.dirname(filePath), input.keep ?? SCREENSHOT_KEEP_DEFAULT);
    }

    return {
      pageId,
      filePath,
      bytes: resized.buffer.byteLength,
      sha256: createHash('sha256').update(resized.buffer).digest('hex'),
      width: resized.width,
      height: resized.height,
      resized: resized.resized,
      capturedAt
    };
  }

  public listConsoleMessages(
    contextKeyHash: string,
    input: { pageId?: number; limit?: number; type?: ConsoleMessageType }
  ): { messages: ConsoleEntry[] } {
    const slot = this.ensureSlot(contextKeyHash);

    let messages = slot.consoleEntries;
    if (typeof input.pageId === 'number') {
      messages = messages.filter((message) => message.pageId === input.pageId);
    }
    if (input.type) {
      messages = messages.filter((message) => message.type === input.type);
    }

    if (input.limit && input.limit > 0) {
      messages = messages.slice(-input.limit);
    }

    return {
      messages
    };
  }

  public getConsoleMessage(contextKeyHash: string, id: number): { message: ConsoleEntry } {
    const slot = this.ensureSlot(contextKeyHash);
    const message = slot.consoleEntries.find((entry) => entry.id === id);

    if (!message) {
      throw new AppError(`Console message ${id} was not found.`, {
        code: ERROR_CODE.PAGE_NOT_FOUND,
        details: { id },
        suggestions: ['Run: cdt console list --output json']
      });
    }

    return {
      message
    };
  }

  public async waitConsoleMessage(
    contextKeyHash: string,
    input: { pageId?: number; pattern: string; type?: ConsoleMessageType; timeoutMs?: number }
  ): Promise<{ message: ConsoleEntry }> {
    const slot = this.ensureSlot(contextKeyHash);
    const matcher = parsePattern(input.pattern);
    const deadline = Date.now() + toTimeout(input.timeoutMs);

    while (Date.now() < deadline) {
      const found = slot.consoleEntries.find((entry) => {
        if (input.pageId !== undefined && entry.pageId !== input.pageId) {
          return false;
        }
        if (input.type && entry.type !== input.type) {
          return false;
        }
        return matchesPattern(matcher, entry.text);
      });

      if (found) {
        return { message: found };
      }

      await sleep(100);
    }

    throw new AppError(`Timed out waiting for console pattern: ${input.pattern}`, {
      code: ERROR_CODE.TIMEOUT,
      details: { pattern: input.pattern, pageId: input.pageId, type: input.type },
      suggestions: ['Increase timeout: --timeout <ms>', 'Run: cdt console list --output json']
    });
  }

  public listNetworkRequests(
    contextKeyHash: string,
    input: { pageId?: number; limit?: number; method?: string }
  ): { requests: NetworkEntry[] } {
    const slot = this.ensureSlot(contextKeyHash);

    let requests = slot.networkEntries;
    if (typeof input.pageId === 'number') {
      requests = requests.filter((entry) => entry.pageId === input.pageId);
    }
    if (input.method) {
      requests = requests.filter((entry) => entry.method.toLowerCase() === input.method?.toLowerCase());
    }

    if (input.limit && input.limit > 0) {
      requests = requests.slice(-input.limit);
    }

    return {
      requests
    };
  }

  public async getNetworkRequest(
    contextKeyHash: string,
    input: { id: number; requestFilePath?: string; responseFilePath?: string }
  ): Promise<{ request: NetworkEntry }> {
    const slot = this.ensureSlot(contextKeyHash);
    const request = slot.networkEntries.find((entry) => entry.id === input.id);

    if (!request) {
      throw new AppError(`Network request ${input.id} was not found.`, {
        code: ERROR_CODE.NETWORK_REQUEST_NOT_FOUND,
        details: { id: input.id },
        suggestions: ['Run: cdt network list --output json']
      });
    }

    if (input.requestFilePath) {
      await mkdir(path.dirname(input.requestFilePath), { recursive: true });
      await writeFile(input.requestFilePath, request.requestBody ?? '', 'utf8');
    }

    if (input.responseFilePath) {
      await mkdir(path.dirname(input.responseFilePath), { recursive: true });
      await writeFile(input.responseFilePath, request.responseBody ?? '', 'utf8');
    }

    return {
      request
    };
  }

  public async waitNetworkRequest(
    contextKeyHash: string,
    input: { pageId?: number; pattern: string; method?: string; status?: number; timeoutMs?: number }
  ): Promise<{ request: NetworkEntry }> {
    const slot = this.ensureSlot(contextKeyHash);
    const matcher = parsePattern(input.pattern);
    const deadline = Date.now() + toTimeout(input.timeoutMs);

    while (Date.now() < deadline) {
      const found = slot.networkEntries.find((entry) => {
        if (input.pageId !== undefined && entry.pageId !== input.pageId) {
          return false;
        }
        if (input.method && entry.method.toLowerCase() !== input.method.toLowerCase()) {
          return false;
        }
        if (input.status !== undefined && entry.status !== input.status) {
          return false;
        }
        return matchesPattern(matcher, entry.url);
      });

      if (found) {
        return { request: found };
      }

      await sleep(100);
    }

    throw new AppError(`Timed out waiting for network pattern: ${input.pattern}`, {
      code: ERROR_CODE.TIMEOUT,
      details: { pattern: input.pattern, pageId: input.pageId, method: input.method, status: input.status },
      suggestions: ['Increase timeout: --timeout <ms>', 'Run: cdt network list --output json']
    });
  }

  public async setEmulation(
    contextKeyHash: string,
    input: {
      viewport?: Viewport | null;
      userAgent?: string | null;
      networkProfile?: string | null;
      geolocation?: GeolocationOptions | null;
    }
  ): Promise<{ applied: EmulationState }> {
    const slot = this.ensureSlot(contextKeyHash);

    if (input.viewport !== undefined) {
      slot.emulation.viewport = input.viewport;
    }

    if (input.userAgent !== undefined) {
      slot.emulation.userAgent = input.userAgent && input.userAgent.trim().length > 0 ? input.userAgent : slot.defaultUserAgent;
    }

    if (input.networkProfile !== undefined) {
      slot.emulation.networkConditions = this.resolveNetworkConditions(input.networkProfile);
    }

    if (input.geolocation !== undefined) {
      slot.emulation.geolocation = input.geolocation;
    }

    await this.applyEmulationToAllPages(slot);

    return {
      applied: slot.emulation
    };
  }

  public async resetEmulation(contextKeyHash: string): Promise<{ applied: EmulationState }> {
    const slot = this.ensureSlot(contextKeyHash);

    slot.emulation = {
      viewport: null,
      userAgent: slot.defaultUserAgent,
      networkConditions: null,
      geolocation: null
    };

    await this.applyEmulationToAllPages(slot);

    return {
      applied: slot.emulation
    };
  }

  public async traceStart(
    contextKeyHash: string,
    input: { pageId?: number; filePath?: string }
  ): Promise<{ pageId: number; filePath: string; startedAt: string }> {
    const slot = this.ensureSlot(contextKeyHash);

    if (slot.trace) {
      throw new AppError('Trace is already running for this context.', {
        code: ERROR_CODE.SESSION_ALREADY_RUNNING,
        details: { trace: slot.trace },
        suggestions: ['Stop current trace first: cdt trace stop']
      });
    }

    const { pageId, page } = this.resolvePage(slot, input.pageId);
    const filePath =
      input.filePath ??
      path.join(resolveContextDir(contextKeyHash, this.homeDir), 'trace', `trace-${Date.now()}.json`);

    await mkdir(path.dirname(filePath), { recursive: true });
    const session = await this.getOrCreateCdpSession(slot, pageId, page);
    const events: Array<Record<string, unknown>> = [];
    let resolveCompletion: (() => void) | null = null;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const onDataCollected = (payload: { value?: Array<Record<string, unknown>> }): void => {
      if (Array.isArray(payload.value)) {
        events.push(...payload.value);
      }
    };
    const onTracingComplete = (): void => {
      resolveCompletion?.();
    };

    session.on('Tracing.dataCollected', onDataCollected);
    session.on('Tracing.tracingComplete', onTracingComplete);
    await session.send('Tracing.start', {
      transferMode: 'ReportEvents',
      categories: 'devtools.timeline,v8.execute'
    });

    const startedAt = new Date().toISOString();
    slot.trace = {
      pageId,
      filePath,
      startedAt,
      session,
      events,
      onDataCollected,
      onTracingComplete,
      completion
    };

    return {
      pageId,
      filePath,
      startedAt
    };
  }

  public async traceStop(
    contextKeyHash: string,
    input: { filePath?: string }
  ): Promise<{ pageId: number; filePath: string; bytes: number }> {
    const slot = this.ensureSlot(contextKeyHash);

    if (!slot.trace) {
      throw new AppError('No active trace for current context.', {
        code: ERROR_CODE.SESSION_NOT_FOUND,
        suggestions: ['Start one first: cdt trace start']
      });
    }

    const trace = slot.trace;
    const page = slot.pages.get(trace.pageId);
    if (!page || page.isClosed()) {
      throw new AppError('Tracing page is no longer available.', {
        code: ERROR_CODE.PAGE_NOT_FOUND,
        details: { pageId: trace.pageId },
        suggestions: ['Run: cdt trace start again on an active page.']
      });
    }

    await trace.session.send('Tracing.end');
    await Promise.race([trace.completion, sleep(5_000)]);
    trace.session.off('Tracing.dataCollected', trace.onDataCollected);
    trace.session.off('Tracing.tracingComplete', trace.onTracingComplete);

    if (trace.events.length === 0) {
      trace.events.push({
        name: 'browser-cli-trace',
        cat: 'browser-cli',
        ph: 'I',
        ts: Date.now() * 1_000,
        pid: 1,
        tid: 1
      });
    }

    const traceBuffer = Buffer.from(
      JSON.stringify(
        {
          traceEvents: trace.events
        },
        null,
        2
      ),
      'utf8'
    );
    await mkdir(path.dirname(trace.filePath), { recursive: true });
    await writeFile(trace.filePath, traceBuffer);

    const finalPath = input.filePath ?? trace.filePath;
    if (input.filePath && input.filePath !== trace.filePath) {
      await mkdir(path.dirname(input.filePath), { recursive: true });
      await writeFile(input.filePath, traceBuffer);
    }

    slot.trace = null;

    return {
      pageId: trace.pageId,
      filePath: finalPath,
      bytes: traceBuffer.byteLength
    };
  }

  public async traceInsight(
    contextKeyHash: string,
    input: { insightName?: string; filePath?: string }
  ): Promise<{
    filePath: string;
    summary: {
      eventCount: number;
      durationMs: number;
      processCount: number;
      threadCount: number;
    };
    insight: {
      name: string;
      note: string;
    };
  }> {
    const slot = this.ensureSlot(contextKeyHash);
    const filePath =
      input.filePath ??
      slot.trace?.filePath ??
      path.join(resolveContextDir(contextKeyHash, this.homeDir), 'trace', 'latest.json');

    let parsed: { traceEvents?: Array<{ ts?: number; pid?: number; tid?: number }> };
    try {
      const content = await readFile(filePath, 'utf8');
      parsed = JSON.parse(content) as { traceEvents?: Array<{ ts?: number; pid?: number; tid?: number }> };
    } catch (error) {
      throw new AppError('Unable to read trace file.', {
        code: ERROR_CODE.VALIDATION_ERROR,
        details: { filePath, reason: error instanceof Error ? error.message : String(error) },
        suggestions: ['Run trace capture first: cdt trace start && cdt trace stop', 'Or pass a valid --file path']
      });
    }

    const events = parsed.traceEvents ?? [];
    const tsValues = events
      .map((event) => event.ts)
      .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts));

    const minTs = tsValues.length > 0 ? Math.min(...tsValues) : 0;
    const maxTs = tsValues.length > 0 ? Math.max(...tsValues) : 0;
    const durationMs = maxTs >= minTs ? Math.round((maxTs - minTs) / 1000) : 0;

    const processCount = new Set(events.map((event) => event.pid).filter((pid): pid is number => typeof pid === 'number')).size;
    const threadCount = new Set(events.map((event) => `${event.pid ?? 'x'}:${event.tid ?? 'x'}`)).size;

    return {
      filePath,
      summary: {
        eventCount: events.length,
        durationMs,
        processCount,
        threadCount
      },
      insight: {
        name: input.insightName ?? 'overview',
        note: 'Basic trace summary is available. Advanced insight breakdown is planned for future phase.'
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
    if (!slot || !slot.browser.isConnected()) {
      throw new AppError('Session is not running for this context.', {
        code: ERROR_CODE.SESSION_NOT_FOUND,
        details: { contextKeyHash },
        suggestions: ['Run: browser start --output json']
      });
    }

    return slot;
  }

  private findPageId(slot: BrowserSlot, targetPage: Page): number | null {
    for (const [id, page] of slot.pages.entries()) {
      if (page === targetPage) {
        return id;
      }
    }

    return null;
  }

  private async getOrCreateCdpSession(slot: BrowserSlot, pageId: number, page: Page): Promise<CDPSession> {
    const existing = slot.pageCdpSessions.get(pageId);
    if (existing) {
      return existing;
    }

    const created = await slot.context.newCDPSession(page);
    slot.pageCdpSessions.set(pageId, created);
    return created;
  }

  private async assertPointInteractable(page: Page, pageId: number, x: number, y: number): Promise<void> {
    const pointCheck = (await page.evaluate(
      ({ targetX, targetY }: { targetX: number; targetY: number }) => {
        const doc = (globalThis as { document?: { elementFromPoint?: (x: number, y: number) => unknown } }).document;
        const win = (globalThis as {
          window?: {
            innerWidth?: number;
            innerHeight?: number;
            getComputedStyle?: (el: unknown) => { pointerEvents?: string; visibility?: string; display?: string };
          };
        }).window;

        if (targetX < 0 || targetY < 0 || targetX > (win?.innerWidth ?? 0) || targetY > (win?.innerHeight ?? 0)) {
          return {
            ok: false,
            reason: 'out'
          };
        }

        const element = doc?.elementFromPoint?.(targetX, targetY) as
          | {
              tagName?: string;
              getAttribute?: (name: string) => string | null;
              disabled?: boolean;
            }
          | undefined;
        if (!element) {
          return {
            ok: false,
            reason: 'out'
          };
        }

        const style = win?.getComputedStyle?.(element) ?? {};
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') {
          return {
            ok: false,
            reason: 'not-interactable',
            tag: element.tagName?.toLowerCase() ?? null
          };
        }

        if (element.disabled) {
          return {
            ok: false,
            reason: 'disabled',
            tag: element.tagName?.toLowerCase() ?? null
          };
        }

        return {
          ok: true,
          reason: 'ok',
          tag: element.tagName?.toLowerCase() ?? null
        };
      },
      { targetX: x, targetY: y }
    )) as { ok: boolean; reason: 'out' | 'not-interactable' | 'disabled' | 'ok'; tag?: string | null };

    if (pointCheck.ok) {
      return;
    }

    if (pointCheck.reason === 'out') {
      throw new AppError(`Target coordinates are outside interactable viewport: (${x}, ${y})`, {
        code: ERROR_CODE.TARGET_OUT_OF_VIEW,
        details: { pageId, x, y },
        suggestions: ['Run: cdt observe state --output json', 'Use coordinates within viewport bounds.']
      });
    }

    throw new AppError(`Target at (${x}, ${y}) is not interactable.`, {
      code: ERROR_CODE.TARGET_NOT_INTERACTABLE,
      details: { pageId, x, y, reason: pointCheck.reason, tag: pointCheck.tag ?? null },
      suggestions: ['Scroll or adjust coordinates.', 'Use: cdt observe targets --only-visible']
    });
  }

  private async resolveScreenshotPath(
    contextKeyHash: string,
    pageId: number,
    input: { filePath?: string; dirPath?: string; label?: string; format: 'png' | 'jpeg' | 'webp' }
  ): Promise<string> {
    if (input.filePath) {
      await mkdir(path.dirname(input.filePath), { recursive: true });
      return input.filePath;
    }

    const day = new Date().toISOString().slice(0, 10);
    const baseDir =
      input.dirPath ??
      path.join(resolveContextDir(contextKeyHash, this.homeDir), 'artifacts', 'screenshots', day);
    await mkdir(baseDir, { recursive: true });

    const ext = input.format === 'jpeg' ? 'jpg' : input.format;
    const label = sanitizeLabel(input.label);
    return path.join(baseDir, `${Date.now()}-p${pageId}-${label}.${ext}`);
  }

  private async captureWebpViaCdp(
    slot: BrowserSlot,
    pageId: number,
    page: Page,
    input: { fullPage?: boolean; quality?: number }
  ): Promise<Buffer> {
    const session = await this.getOrCreateCdpSession(slot, pageId, page);
    const payload = (await session.send('Page.captureScreenshot', {
      format: 'webp',
      quality: input.quality,
      captureBeyondViewport: input.fullPage === true,
      fromSurface: true
    })) as { data?: string };

    if (typeof payload.data !== 'string' || payload.data.length === 0) {
      throw new AppError('Failed to capture webp screenshot via CDP.', {
        code: ERROR_CODE.INTERNAL_ERROR
      });
    }

    return Buffer.from(payload.data, 'base64');
  }

  private async resizeScreenshotIfNeeded(input: {
      source: Buffer;
      format: 'png' | 'jpeg' | 'webp';
      maxWidth?: number;
      maxHeight?: number;
    }): Promise<{ buffer: Buffer; width: number | null; height: number | null; resized: boolean }> {
    const size = this.detectImageDimensions(input.source, input.format);

    if (!input.maxWidth && !input.maxHeight) {
      return {
        buffer: input.source,
        width: size?.width ?? null,
        height: size?.height ?? null,
        resized: false
      };
    }

    const maxWidth = input.maxWidth ?? Number.MAX_SAFE_INTEGER;
    const maxHeight = input.maxHeight ?? Number.MAX_SAFE_INTEGER;

    if (size && size.width <= maxWidth && size.height <= maxHeight) {
      return {
        buffer: input.source,
        width: size.width,
        height: size.height,
        resized: false
      };
    }

    // Dimension downscaling in Node would require an extra native dependency.
    // Keep current image bytes and expose original dimensions for loop-side decisions.

    return {
      buffer: input.source,
      width: size?.width ?? null,
      height: size?.height ?? null,
      resized: false
    };
  }

  private detectImageDimensions(
    buffer: Buffer,
    format: 'png' | 'jpeg' | 'webp'
  ): { width: number; height: number } | null {
    if (format === 'png') {
      if (buffer.byteLength < 24) {
        return null;
      }
      const signature = buffer.subarray(0, 8).toString('hex');
      if (signature !== '89504e470d0a1a0a') {
        return null;
      }
      return {
        width: buffer.readUInt32BE(16),
        height: buffer.readUInt32BE(20)
      };
    }

    if (format === 'jpeg') {
      if (buffer.byteLength < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return null;
      }

      let offset = 2;
      while (offset + 9 < buffer.byteLength) {
        if (buffer[offset] !== 0xff) {
          offset += 1;
          continue;
        }

        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);

        if (marker >= 0xc0 && marker <= 0xc3) {
          return {
            height: buffer.readUInt16BE(offset + 5),
            width: buffer.readUInt16BE(offset + 7)
          };
        }

        offset += 2 + length;
      }
    }

    return null;
  }

  private async cleanupArtifacts(dirPath: string, keep: number): Promise<void> {
    const names = await readdir(dirPath).catch(() => []);
    if (names.length <= keep) {
      return;
    }

    const entries: Array<{ filePath: string; mtimeMs: number }> = [];
    for (const name of names) {
      const filePath = path.join(dirPath, name);
      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile()) {
        continue;
      }
      entries.push({ filePath, mtimeMs: info.mtimeMs });
    }

    if (entries.length <= keep) {
      return;
    }

    entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const stale = entries.slice(keep);
    await Promise.all(stale.map(async (entry) => rm(entry.filePath, { force: true })));
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

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${chrome.port}`);
    const contexts = browser.contexts();
    const context = contexts[0] ?? (await browser.newContext());

    const slot: BrowserSlot = {
      contextKeyHash,
      chrome,
      browser,
      context,
      pages: new Map<number, Page>(),
      pageCdpSessions: new Map<number, CDPSession>(),
      selectedPageId: null,
      nextPageId: 1,
      headless,
      defaultUserAgent: 'unknown',
      consoleEntries: [],
      nextConsoleId: 1,
      networkEntries: [],
      requestToNetworkId: new WeakMap<PWRequest, number>(),
      nextNetworkId: 1,
      pendingDialogs: new Map<number, Dialog>(),
      emulation: {
        viewport: null,
        userAgent: null,
        networkConditions: null,
        geolocation: null
      },
      trace: null
    };

    const defaultPage = await context.newPage();
    slot.defaultUserAgent = await defaultPage.evaluate(() => navigator.userAgent);
    await defaultPage.close();

    const initialPages = context.pages();
    if (initialPages.length === 0) {
      const initial = await context.newPage();
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

    this.attachPageObservers(slot, id, page);
    void this.applyEmulationToPage(slot, page);

    page.once('close', () => {
      const session = slot.pageCdpSessions.get(id);
      if (session) {
        void session.detach().catch(() => {});
        slot.pageCdpSessions.delete(id);
      }
      slot.pages.delete(id);
      slot.pendingDialogs.delete(id);
      if (slot.selectedPageId === id) {
        const first = slot.pages.keys().next();
        slot.selectedPageId = first.done ? null : first.value;
      }
    });

    return id;
  }

  private attachPageObservers(slot: BrowserSlot, pageId: number, page: Page): void {
    page.on('console', (message) => {
      slot.consoleEntries.push({
        id: slot.nextConsoleId,
        pageId,
        type: message.type(),
        text: message.text(),
        location: {
          url: message.location().url,
          lineNumber: message.location().lineNumber,
          columnNumber: message.location().columnNumber
        },
        createdAt: new Date().toISOString()
      });
      slot.nextConsoleId += 1;
    });

    page.on('request', (request) => {
      const id = slot.nextNetworkId;
      const now = new Date().toISOString();

      slot.networkEntries.push({
        id,
        pageId,
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        requestHeaders: toRequestHeaders(request.headers()),
        requestBody: toOptionalString(request.postData()),
        status: null,
        statusText: null,
        ok: null,
        responseHeaders: {},
        responseBody: null,
        failureText: null,
        createdAt: now,
        updatedAt: now
      });

      slot.requestToNetworkId.set(request, id);
      slot.nextNetworkId += 1;
    });

    page.on('response', async (response) => {
      const request = response.request();
      const id = slot.requestToNetworkId.get(request);
      if (!id) {
        return;
      }

      const entry = slot.networkEntries.find((candidate) => candidate.id === id);
      if (!entry) {
        return;
      }

      entry.status = response.status();
      entry.statusText = response.statusText();
      entry.ok = response.ok();
      entry.responseHeaders = toResponseHeaders(response.headers());
      entry.updatedAt = new Date().toISOString();

      try {
        entry.responseBody = await response.text();
      } catch {
        entry.responseBody = null;
      }
    });

    page.on('requestfailed', (request) => {
      const id = slot.requestToNetworkId.get(request);
      if (!id) {
        return;
      }

      const entry = slot.networkEntries.find((candidate) => candidate.id === id);
      if (!entry) {
        return;
      }

      entry.failureText = request.failure()?.errorText ?? null;
      entry.updatedAt = new Date().toISOString();
    });

    page.on('dialog', (dialog) => {
      slot.pendingDialogs.set(pageId, dialog);
    });
  }

  private async fillElementOnPage(page: Page, pageId: number, selector: string, value: string): Promise<void> {
    const exists = await page.$(selector);
    if (!exists) {
      throw new AppError(`Element not found for selector: ${selector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector, pageId },
        suggestions: selectorSuggestions(selector)
      });
    }

    const updated = await page.evaluate(
      ({ targetSelector, targetValue }: { targetSelector: string; targetValue: string }) => {
        const documentRef = (globalThis as { document?: { querySelector?: (s: string) => unknown } }).document;
        const node = documentRef?.querySelector?.(targetSelector) as {
          value?: string;
          isContentEditable?: boolean;
          textContent?: string | null;
          dispatchEvent?: (event: unknown) => void;
        } | null;

        if (!node) {
          return false;
        }

        if (typeof node.value === 'string') {
          node.value = targetValue;
        } else if (node.isContentEditable) {
          node.textContent = targetValue;
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
      { targetSelector: selector, targetValue: value }
    );

    if (!updated) {
      throw new AppError(`Element cannot be filled: ${selector}`, {
        code: ERROR_CODE.ELEMENT_NOT_FOUND,
        details: { selector, pageId },
        suggestions: ['Target an input/textarea/contenteditable element.', 'Run: cdt capture snapshot --output json']
      });
    }
  }

  private async applyEmulationToAllPages(slot: BrowserSlot): Promise<void> {
    for (const page of slot.pages.values()) {
      await this.applyEmulationToPage(slot, page);
    }
  }

  private async applyEmulationToPage(slot: BrowserSlot, page: Page): Promise<void> {
    const pageId = this.findPageId(slot, page);
    if (pageId === null) {
      return;
    }

    if (slot.emulation.viewport) {
      await page.setViewportSize({
        width: slot.emulation.viewport.width,
        height: slot.emulation.viewport.height
      });
    }

    const userAgent = slot.emulation.userAgent ?? slot.defaultUserAgent;
    const session = await this.getOrCreateCdpSession(slot, pageId, page);
    await session.send('Network.enable');
    await session.send('Network.setUserAgentOverride', {
      userAgent
    });

    const network = slot.emulation.networkConditions;
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: network?.latency ?? 0,
      downloadThroughput: network?.download ?? -1,
      uploadThroughput: network?.upload ?? -1,
      connectionType: 'none'
    });

    await slot.context.setGeolocation(slot.emulation.geolocation ?? null);
    if (slot.emulation.geolocation) {
      await slot.context.grantPermissions(['geolocation']);
    } else {
      await slot.context.clearPermissions();
    }
  }

  private resolveNetworkConditions(networkProfile?: string | null): NetworkConditions | null {
    if (!networkProfile || networkProfile === 'none' || networkProfile === 'reset') {
      return null;
    }

    const fromTable = NETWORK_PROFILE_TABLE[networkProfile];
    if (!fromTable) {
      throw new AppError(`Unsupported network profile: ${networkProfile}`, {
        code: ERROR_CODE.VALIDATION_ERROR,
        details: { networkProfile },
        suggestions: [
          'Use one of: Slow 3G, Fast 3G, Slow 4G, Fast 4G',
          'Or clear with: cdt emulation reset'
        ]
      });
    }

    return fromTable;
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
      const page = await slot.context.newPage();
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
    await Promise.all(
      Array.from(slot.pageCdpSessions.values()).map(async (session) => {
        await session.detach().catch(() => {});
      })
    );
    slot.pageCdpSessions.clear();

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
