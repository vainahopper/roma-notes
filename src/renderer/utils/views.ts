// Special main views. Prefixed so they can never collide with a page id
// (a page titled "Graph" gets the id "graph").
export const ALL_PAGES_VIEW = '__all-pages'
export const GRAPH_VIEW = '__graph'

export function isSpecialView(view: string): boolean {
  return view === 'daily' || view.startsWith('__')
}
