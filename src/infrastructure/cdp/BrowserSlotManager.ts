import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { Launcher, launch, type LaunchedChrome } from 'chrome-launcher';
import {
  PredefinedNetworkConditions,
  connect,
  type Browser,
  type ConsoleMessageType,
  type Dialog,
  type GeolocationOptions,
  type HTTPRequest,
  type KeyInput,
  type NetworkConditions,
  type Page,
  type Viewport
} from 'puppeteer-core';

import { AppError } from '../../shared/errors/AppError.js';
import { ERROR_CODE } from '../../shared/errors/ErrorCode.js';
import { resolveContextDir } from '../store/paths.js';

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
};

type BrowserSlot = {
  contextKeyHash: string;
  chrome: LaunchedChrome;
  browser: Browser;
  pages: Map<number, Page>;
  selectedPageId: number | null;
  nextPageId: number;
  headless: boolean;
  defaultUserAgent: string;
  consoleEntries: ConsoleEntry[];
  nextConsoleId: number;
  networkEntries: NetworkEntry[];
  requestToNetworkId: WeakMap<HTTPRequest, number>;
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

    await page.setViewport({
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

    await elementHandle.uploadFile(input.filePath);

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

    await page.keyboard.press(input.key as KeyInput);

    return {
      pageId,
      key: input.key
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

  public async screenshot(
    contextKeyHash: string,
    input: {
      pageId?: number;
      filePath?: string;
      fullPage?: boolean;
      format?: 'png' | 'jpeg' | 'webp';
      quality?: number;
    }
  ): Promise<{ pageId: number; filePath: string | null; bytes: number }> {
    const slot = this.ensureSlot(contextKeyHash);
    const { pageId, page } = this.resolvePage(slot, input.pageId);

    const result = await page.screenshot({
      path: input.filePath,
      fullPage: input.fullPage,
      type: input.format,
      quality: input.quality
    });

    const bytes = typeof result === 'string' ? Buffer.byteLength(result) : result.byteLength;

    return {
      pageId,
      filePath: input.filePath ?? null,
      bytes
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
    await page.tracing.start({ path: filePath });

    const startedAt = new Date().toISOString();
    slot.trace = {
      pageId,
      filePath,
      startedAt
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

    const output = await page.tracing.stop();
    const traceBuffer = output ? Buffer.from(output) : await readFile(trace.filePath);

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
      headless,
      defaultUserAgent: await browser.userAgent(),
      consoleEntries: [],
      nextConsoleId: 1,
      networkEntries: [],
      requestToNetworkId: new WeakMap<HTTPRequest, number>(),
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

    this.attachPageObservers(slot, id, page);
    void this.applyEmulationToPage(slot, page);

    page.once('close', () => {
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
      (targetSelector, targetValue) => {
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
      selector,
      value
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
    if (slot.emulation.viewport !== undefined) {
      await page.setViewport(slot.emulation.viewport);
    }

    const userAgent = slot.emulation.userAgent ?? slot.defaultUserAgent;
    await page.setUserAgent(userAgent);

    await page.emulateNetworkConditions(slot.emulation.networkConditions);

    if (slot.emulation.geolocation) {
      await page.setGeolocation(slot.emulation.geolocation);
    }
  }

  private resolveNetworkConditions(networkProfile?: string | null): NetworkConditions | null {
    if (!networkProfile || networkProfile === 'none' || networkProfile === 'reset') {
      return null;
    }

    const fromTable = PredefinedNetworkConditions[networkProfile as keyof typeof PredefinedNetworkConditions];
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
