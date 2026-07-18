// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Listener<T = any> = (event: T) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventMap = Record<string, any>;

export class SimpleEventEmitter<Events extends EventMap = EventMap> {
  private listeners: Map<string, Listener[]> = new Map();

  public on<K extends string & keyof Events>(event: K, listener: Listener<Events[K]>): void;
  public on(event: string, listener: Listener): void;
  public on(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener as Listener);
  }

  /**
   * Subscribe to an event for a single emission only.
   * The listener is automatically removed after first invocation.
   */
  public once<K extends string & keyof Events>(event: K, listener: Listener<Events[K]>): void;
  public once(event: string, listener: Listener): void;
  public once(event: string, listener: Listener): void {
    const wrapper: Listener = (data) => {
      this.off(event, wrapper);
      listener(data);
    };
    this.on(event, wrapper);
  }

  public off<K extends string & keyof Events>(event: K, listener: Listener<Events[K]>): void;
  public off(event: string, listener: Listener): void;
  public off(event: string, listener: Listener): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    this.listeners.set(event, arr.filter(l => l !== listener));
  }

  public emit<K extends string & keyof Events>(event: K, data?: Events[K]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public emit(event: string, data?: any): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public emit(event: string, data?: any): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    // Iterate over a copy to avoid issues if listeners modify the array
    [...arr].forEach(listener => listener(data));
  }

  public offAll(): void {
    this.listeners.clear();
  }
}
