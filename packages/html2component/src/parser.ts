import { Parser } from 'htmlparser2'

/**
 * Represents an attribute for an HTML node.
 */
export interface NodeAttribute {
  /**
   * The attribute name. A non-empty string.
   */
  readonly name: string

  /**
   * The attribute value, or an empty string. Currently, it is not possible to distinguish between `attribute=""` or `attribute`.
   * The attribute whitespace and newlines are replaced by a single whitespace.
   * The value is also trimmed.
   */
  readonly value: string
}

/**
 * Represents an reference node.
 */
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
  readonly parent: Node | null

  /**
   * The node type.
   */
  readonly type: string

  startIndex: number
  endIndex: number
}

/**
 * Represents an #text node.
 */
export interface TextNode extends RefNode {
  /**
   * The node type, always `text`.
   */
  readonly type: 'text'

  /**
   * The node text. It is trimmed but not decoded. All `\r\n` are replaced by `\n`
   */
  textContent: string
}

/**
 * Represents a tag node.
 */
export interface TagNode extends RefNode {
  /**
   * The node type, always `tag`.
   */
  readonly type: 'tag'

  /**
   * The node tag, for example `div` or `button`, case sensitive.
   */
  readonly tag: string

  /**
   * The node attributes, it can be empty. An array that can be sorted explicitly.
   */
  attributes: NodeAttribute[]

  /**
   * The node children, it can be empty.
   */
  children: Node[]
}

/**
 * Represents either a text node or a tag node.
 */
export type Node = TextNode | TagNode

/**
 * Returns `true` when node is a `TextNode`.
 */
export function isTextNode(node: Node | null | undefined): node is TextNode {
  return !!node && node.type === 'text'
}

/**
 * Returns `true` when node is a `TagNode`.
 */
export function isTagNode(node: Node | null | undefined): node is TagNode {
  return !!node && node.type === 'tag'
}

function normalizeAttributes(attrs: { [s: string]: string }): NodeAttribute[] {
  return Object.keys(attrs).map<NodeAttribute>((name) => {
    return {
      name,
      // this will replace all newlines and space with a single normalized space
      value: attrs[name].replace(/[\r\n\x0B\x0C\u0085\u2028\u2029]+/g, ' ').trim()
    }
  })
}

/**
 * Parse an html string and return an array of nodes.
 *
 * ## Example
 *
 * ```ts
 *   const nodes = parse('<div class="container"></div>')
 * ```
 */
export function parse(html: string): Node[] {
  const flatNodes: Node[] = []

  // the parser
  let parser: Parser

  // track and count nodes
  let refCount = 0

  let lastNode: Node | undefined = undefined
  const nodeStack: TagNode[] = []
  function parent(): TagNode | null {
    return nodeStack[nodeStack.length - 1] || null
  }

  parser = new Parser(
    {
      onopentag(name, attribs) {
        const node: TagNode = {
          refId: ++refCount,
          parent: parent(),
          type: 'tag',
          tag: name,
          attributes: normalizeAttributes(attribs),
          children: [],
          startIndex: parser.startIndex,
          endIndex: parser.endIndex
        }

        lastNode = node
        nodeStack.push(node)
      },
      onclosetag() {
        const node = nodeStack.pop()!
        node.endIndex = parser.endIndex

        lastNode = undefined
        flatNodes.push(node)
      },
      ontext(text) {
        // maybe do not normalize inside script/style
        // if (parent?.type === 'tag' && parent.nodeType === 'script') {
        // }

        // HACK: this is potentially wrong, &nbsp; or &#160; must be used to preserve trailing spaces
        // also we need to normalize the line breaks actually
        text = text.trim().replace(/\r?\n/g, '\n')

        // remove empty node or comments
        if (!text || text.startsWith('<!--')) {
          return
        }

        // append this node
        if (lastNode?.type === 'text') {
          lastNode.textContent += text
          lastNode.endIndex = parser.endIndex
          return
        }

        const node: TextNode = {
          refId: ++refCount,
          parent: parent(),
          type: 'text',
          textContent: text,
          startIndex: parser.startIndex,
          endIndex: parser.endIndex
        }

        lastNode = node
        flatNodes.push(node)
      }
    },
    {
      xmlMode: false,
      lowerCaseTags: false,
      lowerCaseAttributeNames: false,
      decodeEntities: false
    }
  )

  parser.write(html)
  parser.end()

  flatNodes.forEach((node) => {
    const parent = node.parent
    if (parent?.type === 'tag') {
      parent.children.push(node)
    }
  })

  return flatNodes.filter((node) => node.parent === null)
}

/**
 * Executes a callback for each node recursively.
 *
 * ### Notice
 *
 * This method do not check for a flatten array, make sure the `nodes` array has not been flatten,
 * if the array has been flatten, this method may invoke the `visitor` twice for the same node.
 */
export function walk(nodes: Node[], visitor: (node: Node) => void): void {
  nodes.forEach((node) => {
    visitor(node)
    if (isTagNode(node)) {
      walk(node.children, visitor)
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

/**
 * Find a node parent.
 */
export function findParent(node: Node, filter: (parentNode: Node) => boolean): Node | undefined {
  if (node.parent) {
    return filter(node.parent) === true ? node.parent : findParent(node.parent, filter)
  }

  // no more parents to go
  return undefined
}

export function reduce<T>(nodes: Node[], visit: (node: Node, parent: T | undefined) => T): T[] {
  const nodeTo = new Map<number, T | undefined>()
  function getParent(node: Node): T | undefined {
    if (node.parent) {
      return nodeTo.get(node.parent.refId)
    }
  }

  function reduceWalk(nodes: Node[]) {
    return nodes.map((node) => {
      const reduced = visit(node, getParent(node))
      nodeTo.set(node.refId, reduced)

      if (isTagNode(node)) {
        reduceWalk(node.children)
      }

      return reduced
    })
  }

  return reduceWalk(nodes)
}
