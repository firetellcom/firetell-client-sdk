export type Listener<T = any> = (event: T) => void;

export class SimpleEventEmitter {
  private listeners: Map<string, Listener[]> = new Map();

  on<T = any>(event: string, listener: Listener<T>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener as Listener);
  }

  off<T = any>(event: string, listener: Listener<T>): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    this.listeners.set(event, arr.filter(l => l !== listener));
  }

  emit<T = any>(event: string, data?: T): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    arr.forEach(listener => listener(data));
  }
  offAll() {
    this.listeners = new Map();
  }
}
