import type { Node as ParseNode, NodeTag as ParseNodeTag } from 'posthtml-parser'
import { parser as posthtmlParse } from 'posthtml-parser'

// TODO: readonly refId, parent are not enforced, it's just an indication for the consumer

export interface RefNode {
  /**
   * The unique node id, positive non-zero integer .
   */
  readonly refId: number

  /**
   * The node parent, or `null` if it's a root node.
   *
   * ### Remarks
   * The parent node is `null`, when you check explicitly, make sure to use `node.parent === null`.
   */
  readonly parent: TagNode | null
}

/**
 * Represents an #text node.
 */
export interface TextNode extends RefNode {
  /**
   * The node text. It is trimmed but not decoded.
   */
  content: string
}

/**
 * Represents an attribute for an HTML node.
 */
export interface NodeAttribute {
  /**
   * The attribute name. A non-empty string, trimmed.
   */
  name: string

  /**
   * The attribute value, or an empty string. Currently, it is not possible to distinguish between `attribute=""` or `attribute`.
   */
  value: string
}

/**
 * Represents an HTML node.
 */
export interface TagNode extends RefNode {
  /**
   * The node tag, for example `div` or `button`, case sensitive.
   */
  tag: string

  /**
   * The node attributes, it can be empty. An array that can be sorted explicitly.
   */
  attrs: NodeAttribute[]

  /**
   * The node children, it can be empty.
   */
  content: Node[]
}

/**
 * Represents a generic node.
 */
export type Node = TextNode | TagNode

/**
 * Returns `true` when node is a `TextNode`.
 */
export function isTextNode(node: Node): node is TextNode {
  return typeof node.content === 'string'
}

/**
 * Returns `true` when node is a `TagNode`.
 */
export function isTagNode(node: Node): node is TagNode {
  return Array.isArray(node.content)
}

function normalizeAttribute(name: string, value: string | number | boolean): NodeAttribute {
  name = (name || '').trim()

  if (typeof value === 'string') {
    // HACK: are we sure we want to replace all spaces with a single one?
    value = value.replace(/\s/g, ' ').replace(/\s\s+/g, ' ').trim()
  } else {
    value = ''
  }

  return { name, value }
}

function normalizeAttributes(node: ParseNodeTag): NodeAttribute[] {
  if (!node.attrs) {
    return []
  }

  return Object.keys(node.attrs)
    .map((key) => normalizeAttribute(key, node.attrs![key]))
    .filter((attr) => attr.name)
}

function normalizeTextNode(node: string): Node | undefined {
  // trim by default use &nbsp; or &#160; if you want to keep the space
  node = (node || '').trim()

  // remove empty text node, this is safe to do since we do not decode anything
  if (!node) {
    return undefined
  }

  // remove comments
  if (node.startsWith('<!--')) {
    return undefined
  }

  return {
    parent: null,
    refId: 0,
    content: node
  }
}

function normalizeNode(node: ParseNode): Node | undefined {
  if (typeof node === 'string') {
    return normalizeTextNode(node)
  }

  if (typeof node === 'object' && typeof node.tag === 'string') {
    const tag = node.tag.trim()

    // sanity check, it should never happen
    if (!tag) return undefined

    let attrs = normalizeAttributes(node)

    let children: (Node | undefined)[] = []

    if (typeof node.content === 'string') {
      children = [normalizeNode(node.content)]
    } else if (Array.isArray(node.content)) {
      children = node.content.map((node) => {
        if (Array.isArray(node)) {
          throw new Error('Cannot parse nested HTML content.')
        }

        return normalizeNode(node)
      })
    }

    children = children.filter(Boolean)

    return {
      parent: null,
      refId: 0,
      tag,
      attrs,
      content: children as Node[]
    }
  }

  return undefined
}

export interface Options {}

/**
 * Parse an html string and return an array of nodes.
 *
 * ## Example
 *
 * ```ts
 *   const nodes = parse('<div class="container"></div>')
 * ```
 */
export function parse(html: string, options?: Options): Node[] {
  const rootNodes = posthtmlParse(html, {
    xmlMode: false,
    decodeEntities: false,
    lowerCaseTags: false,
    lowerCaseAttributeNames: false
  })

  const tree = rootNodes.map((node) => normalizeNode(node)).filter(Boolean) as Node[]

  let i = 1
  function n(node: Node) {
    i++
    ;(node as any).refId = i
    if (Array.isArray(node.content)) {
      node.content.forEach((node) => n(node))
    }
  }

  tree.forEach((node) => n(node))

  function setParent(parent: TagNode, child: Node) {
    ;(child as any).parent = parent
    if (isTagNode(child)) {
      child.content.forEach((nested) => {
        setParent(child, nested)
      })
    }
  }

  tree.forEach((node) => {
    if (isTagNode(node)) {
      node.content.forEach((child) => {
        setParent(node, child)
      })
    }
  })

  return tree
}

/**
 * Executes a callback for each node recursively.
 *
 * ### Notice
 *
 * This method do not check for a flatten array, make sure the `nodes` array has not been flatten,
 * if the array has been flatten, this method may invoke the `visitor` twice for the same node.
 */
export function walk(nodes: Node[], visitor: (node: Node) => void) {
  nodes.forEach((node) => {
    visitor(node)
    if (Array.isArray(node.content)) {
      walk(node.content, visitor)
    }
  })
}

/**
 * Recursively concatenated all the node content into a flat array.
 *
 * ### Notice
 *
 * Executing this method again on an already flatten array will not produce a consistent result,
 * the returning array however always contains uniques, non duplicates nodes.
 */
export function flat(nodes: Node[]): Node[] {
  const nodeSet = new Set<number>()

  const flatNodes: Node[] = []
  walk(nodes, (node) => {
    if (!nodeSet.has(node.refId)) {
      nodeSet.add(node.refId)
      flatNodes.push(node)
    }
  })

  return flatNodes
}

export function findParent(node: Node, filter: (parentNode: Node) => boolean): Node | undefined {
  if (node.parent) {
    return filter(node.parent) === true ? node.parent : findParent(node.parent, filter)
  }

  // no more parents to go
  return undefined
}
