export type Listener<T = any> = (event: T) => void;

type EventMap = Record<string, any>;

export class SimpleEventEmitter<Events extends EventMap = EventMap> {
  private listeners: Map<string, Listener[]> = new Map();

  on<K extends string & keyof Events>(event: K, listener: Listener<Events[K]>): void;
  on(event: string, listener: Listener): void;
  on(event: string, listener: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener as Listener);
  }

  off<K extends string & keyof Events>(event: K, listener: Listener<Events[K]>): void;
  off(event: string, listener: Listener): void;
  off(event: string, listener: Listener): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    this.listeners.set(event, arr.filter(l => l !== listener));
  }

  emit<K extends string & keyof Events>(event: K, data?: Events[K]): void;
  emit(event: string, data?: any): void;
  emit(event: string, data?: any): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    arr.forEach(listener => listener(data));
  }

  offAll(): void {
    this.listeners.clear();
  }
}
