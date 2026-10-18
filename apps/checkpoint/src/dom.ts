type Child = Node | string | number | null | undefined | false

/**
 * Builds elements with text nodes only. Everything shown here comes from Arkiv entities that anyone
 * can write, so nothing is ever parsed as HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(name, value)
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    element.append(typeof child === "string" || typeof child === "number" ? document.createTextNode(String(child)) : child)
  }
  return element
}

export function mono(text: string, title?: string): HTMLElement {
  return h("code", { class: "mono", title }, text)
}

export function link(href: string, text: string, className?: string): HTMLAnchorElement {
  return h("a", { href, class: className, target: "_blank", rel: "noreferrer" }, text)
}
