export interface SseMessageEvent {
  event: string;
  data: any;
  id?: string;
  raw?: string;
}

export interface SseStreamConfig {
  url: string;
  token?: string;
  headers?: Record<string, string>;
  withCredentials?: boolean;
  maxReconnectDelay?: number;
  initialReconnectDelay?: number;
  onOpen?: () => void;
  onMessage?: (event: SseMessageEvent) => void;
  onError?: (error: unknown) => void;
  onConnectionStateChange?: (state: "connecting" | "connected" | "disconnected") => void;
}

/**
 * Lightweight, zero-dependency SSE Stream Client with Authorization Bearer header support.
 * Uses fetch() + ReadableStream on modern browsers and Node.js (18+),
 * with graceful fallback to EventSource (?token=...) for legacy environments.
 */
export class SseStreamClient {
  private config: SseStreamConfig;
  private abortController: AbortController | null = null;
  private nativeEventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay: number;
  private isExplicitlyClosed: boolean = false;
  private _connected: boolean = false;

  constructor(config: SseStreamConfig) {
    this.config = config;
    this.reconnectDelay = config.initialReconnectDelay || 3000;
  }

  public get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Start or restart the SSE connection stream
   */
  public connect(): void {
    this.isExplicitlyClosed = false;
    this.cleanup();
    this.config.onConnectionStateChange?.("connecting");

    // Prefer fetch with ReadableStream (supports Authorization: Bearer header)
    if (typeof fetch !== "undefined" && typeof ReadableStream !== "undefined") {
      void this.connectViaFetch();
    } else if (typeof EventSource !== "undefined") {
      this.connectViaEventSource();
    } else {
      console.warn("SseStreamClient: Neither fetch streams nor EventSource is available in this environment.");
      this.config.onConnectionStateChange?.("disconnected");
    }
  }

  private async connectViaFetch(): Promise<void> {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const headers: Record<string, string> = {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
        ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        ...(this.config.headers || {}),
      };

      const response = await fetch(this.config.url, {
        method: "GET",
        headers,
        signal,
      });

      if (!response.ok) {
        throw new Error(`SSE stream connection failed: HTTP ${response.status} ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("SSE response body is not readable");
      }

      this._connected = true;
      this.reconnectDelay = this.config.initialReconnectDelay || 3000;
      this.config.onOpen?.();
      this.config.onConnectionStateChange?.("connected");

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || ""; // retain incomplete line in buffer

        let currentEvent = "message";
        let currentData = "";
        let currentId = "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            // End of an SSE event block (empty line \n\n)
            if (currentData) {
              let parsedData: any = currentData;
              try {
                parsedData = JSON.parse(currentData);
              } catch {
                // Keep string if not valid JSON
              }
              this.config.onMessage?.({
                event: currentEvent,
                data: parsedData,
                id: currentId || undefined,
                raw: currentData,
              });
              currentEvent = "message";
              currentData = "";
              currentId = "";
            }
            continue;
          }

          if (trimmed.startsWith(":")) {
            // Comment / keep-alive ping line
            continue;
          }

          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("data:")) {
            const dataPart = trimmed.slice(5).trim();
            currentData = currentData ? `${currentData}\n${dataPart}` : dataPart;
          } else if (trimmed.startsWith("id:")) {
            currentId = trimmed.slice(3).trim();
          }
        }
      }

      // Stream completed normally (server closed connection)
      this._connected = false;
      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    } catch (error: any) {
      this._connected = false;
      if (signal.aborted || this.isExplicitlyClosed) {
        return;
      }
      this.config.onError?.(error);
      this.scheduleReconnect();
    }
  }

  private connectViaEventSource(): void {
    try {
      const url = new URL(this.config.url, typeof window !== "undefined" ? window.location.href : "http://localhost");
      if (this.config.token) {
        url.searchParams.set("token", this.config.token);
      }

      this.nativeEventSource = new EventSource(url.toString(), {
        withCredentials: this.config.withCredentials || false,
      });

      this.nativeEventSource.onopen = () => {
        this._connected = true;
        this.reconnectDelay = this.config.initialReconnectDelay || 3000;
        this.config.onOpen?.();
        this.config.onConnectionStateChange?.("connected");
      };

      this.nativeEventSource.onmessage = (e: MessageEvent) => {
        let parsedData: any = e.data;
        try {
          parsedData = JSON.parse(e.data);
        } catch {
          // Keep raw string if not JSON
        }
        this.config.onMessage?.({
          event: parsedData?.event || e.type || "message",
          data: parsedData,
          raw: typeof e.data === "string" ? e.data : undefined,
        });
      };

      this.nativeEventSource.onerror = (err) => {
        this._connected = false;
        if (this.isExplicitlyClosed) return;
        this.config.onError?.(err);
        this.config.onConnectionStateChange?.("disconnected");
      };
    } catch (err) {
      this._connected = false;
      this.config.onError?.(err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.isExplicitlyClosed) return;
    this.cleanup();
    this.config.onConnectionStateChange?.("disconnected");

    const maxDelay = this.config.maxReconnectDelay || 60000;
    const currentDelay = this.reconnectDelay;
    const jitter = Math.random() * 1000;
    const nextDelay = Math.min(currentDelay + jitter, maxDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, maxDelay);

    this.config.onConnectionStateChange?.("connecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isExplicitlyClosed) {
        this.connect();
      }
    }, nextDelay);
  }

  /**
   * Stop the SSE connection and cancel reconnect timers
   */
  public close(): void {
    this.isExplicitlyClosed = true;
    this._connected = false;
    this.cleanup();
    this.config.onConnectionStateChange?.("disconnected");
  }

  private cleanup(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.nativeEventSource) {
      this.nativeEventSource.close();
      this.nativeEventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
