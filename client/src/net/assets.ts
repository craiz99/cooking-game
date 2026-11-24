/**
 * Resolves a static asset path (e.g. "/assets/chefs/purple_bat.png") against Vite's
 * configured BASE_URL so assets load identically on both root server deploys ("/")
 * and GitHub Pages project subpaths ("/cooking-game/").
 */
export function assetUrl(webPath: string): string {
  const base =
    typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL
      ? import.meta.env.BASE_URL
      : '/';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = webPath.replace(/^\/+/, '');
  return `${cleanBase}${cleanPath}`;
}
