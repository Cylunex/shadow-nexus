import type { ThemeSnapshot } from "@deepseek-ai/dsh-client-ui-theme/client";

const DARK_ATTRIBUTE = "data-ds-dark-theme";

/** Projects the upstream theme service onto the document after ui-layout is disabled. */
export class NexusThemePresenter {
  private readonly appliedTokens: string[] = [];
  private readonly themeColorMeta: HTMLMetaElement;

  constructor() {
    this.themeColorMeta = document.createElement("meta");
    this.themeColorMeta.name = "theme-color";
    this.themeColorMeta.dataset.shadowNexus = "true";
  }

  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme;
    document.documentElement.style.colorScheme = scheme;
    if (scheme === "dark") document.body.setAttribute(DARK_ATTRIBUTE, "");
    else document.body.removeAttribute(DARK_ATTRIBUTE);
    for (const name of this.appliedTokens.splice(0)) document.body.style.removeProperty(name);
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      document.body.style.setProperty(name, value);
      this.appliedTokens.push(name);
    }
    this.themeColorMeta.content = getComputedStyle(document.body).backgroundColor;
    if (!this.themeColorMeta.isConnected) document.head.append(this.themeColorMeta);
  }

  dispose(): void {
    document.documentElement.style.removeProperty("color-scheme");
    document.body.removeAttribute(DARK_ATTRIBUTE);
    for (const name of this.appliedTokens.splice(0)) document.body.style.removeProperty(name);
    this.themeColorMeta.remove();
  }
}
