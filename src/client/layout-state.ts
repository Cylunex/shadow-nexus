export interface NexusLayoutSnapshot {
  readonly sidebarOpen: boolean;
  readonly detailsOpen: boolean;
  readonly assistantOpen: boolean;
}

const INITIAL: NexusLayoutSnapshot = Object.freeze({ sidebarOpen: true, detailsOpen: false, assistantOpen: false });

/** Minimal implementation of the DSH layout service consumed by Conversation. */
export class NexusLayoutState {
  private snapshot: NexusLayoutSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();

  getSnapshot(): NexusLayoutSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  toggleSidebar(): void {
    this.publish(Object.freeze({ ...this.snapshot, sidebarOpen: !this.snapshot.sidebarOpen }));
  }

  openDetails(): void {
    this.publish(Object.freeze({ ...this.snapshot, detailsOpen: true }));
  }

  closeDetails(): void {
    this.publish(Object.freeze({ ...this.snapshot, detailsOpen: false }));
  }

  openAssistant(): void {
    this.publish(Object.freeze({ ...this.snapshot, assistantOpen: true }));
  }

  closeAssistant(): void {
    this.publish(Object.freeze({ ...this.snapshot, assistantOpen: false, detailsOpen: false }));
  }

  private publish(next: NexusLayoutSnapshot): void {
    if (this.snapshot.sidebarOpen === next.sidebarOpen
      && this.snapshot.detailsOpen === next.detailsOpen
      && this.snapshot.assistantOpen === next.assistantOpen) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
