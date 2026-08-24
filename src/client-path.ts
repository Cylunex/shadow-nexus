const PLUGIN_PATH = "/plugins/@cylunex/shadow-nexus/client.js";

export function nexusBasePathFromPluginUrl(pluginUrl: string | undefined): string {
  if (pluginUrl === undefined || pluginUrl.trim() === "") return "";
  let pathname: string;
  try {
    pathname = new URL(pluginUrl, "http://dsh.local").pathname;
  } catch {
    return "";
  }
  const pluginIndex = pathname.indexOf(PLUGIN_PATH);
  if (pluginIndex < 0) return "";
  const basePath = pathname.slice(0, pluginIndex).replace(/\/+$/u, "");
  return basePath === "/" ? "" : basePath;
}
