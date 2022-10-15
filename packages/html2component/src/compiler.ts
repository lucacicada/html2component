import { decode } from 'html-entities'
import { Node, TagNode, TextNode, NodeAttribute, reduce } from './parser'
import { parse, flat, isTextNode, isTagNode } from './parser'
import { trimAny } from './utils'

export interface VariableAttribute {
  readonly type: 'variable'
  readonly name: string
  readonly variable: string
}

export interface RefAttribute {
  readonly type: 'ref'
  readonly name: string
}

export interface EventAttribute {
  readonly type: 'event'
  readonly eventName: string
  readonly modifiers: string[]
  readonly variableName: string
}

export interface GenericAttribute {
  readonly type: 'attribute'
  readonly name: string
  readonly value: string
}

export type DeclaredAttribute = VariableAttribute | RefAttribute | EventAttribute | GenericAttribute

/**
 * Compile a `NodeAttribute`.
 */
export function compileAttribute({ name, value }: NodeAttribute): DeclaredAttribute | undefined {
  // compound assignment, unused
  if (name.startsWith('=')) {
    return undefined
  }

  // reference assignment
  if (name === '#ref') {
    const refAttribute: RefAttribute = {
      type: 'ref',
      name: value.trim() || 'el'
    }

    return refAttribute
  }

  // variable shorthand
  if (name.startsWith('{')) {
    const variableName = trimAny(name, ['{', '}']).trim()

    const variableAttribute: VariableAttribute = {
      type: 'variable',
      name: variableName,
      variable: variableName
    }

    return variableAttribute
  }

  // variable assignment
  if (value.startsWith('{')) {
    // indicates an event
    if (name.indexOf(':') > 0) {
      const eventParts = name.split(':')
      const on = eventParts[0]
      const eventNameParts = eventParts[1].split(/[\|\.]/)

      if (on === 'on') {
        const eventName = eventNameParts[0]
        const variable = trimAny(value, ['{', '}']).trim()

        const eventAttribute: EventAttribute = {
          type: 'event',
          eventName,
          modifiers: eventNameParts.slice(1),
          variableName: variable
        }

        return eventAttribute
      }
    }

    const variableAttribute: VariableAttribute = {
      type: 'variable',
      name,
      variable: trimAny(value, ['{', '}']).trim()
    }

    return variableAttribute
  }

  const genericAttribute: GenericAttribute = {
    type: 'attribute',
    name,
    value
  }

  return genericAttribute
}

export interface CompiledNode {
  readonly node: Node
  readonly parent: DeclaredNode | null
  readonly type: string
}

export interface TextElementNode extends CompiledNode {
  readonly type: 'text'
  readonly content: string
}

export interface ElementNode extends CompiledNode {
  readonly type: 'svg' | 'element'
  readonly tag: string
  readonly refTag: string | undefined
  readonly events: EventAttribute[]
  readonly variableAttributes: VariableAttribute[]
  readonly attributes: GenericAttribute[]
  readonly children: DeclaredNode[]
}

export type DeclaredNode = TextElementNode | ElementNode

function shouldRenderAsSvg(node: Node) {
  function isSvgNode(node: Node): boolean {
    if (isTagNode(node) && node.tag === 'svg') {
      return true

      // return node.attrs.findIndex((attr) => attr.name === 'xmlns' && attr.value === 'http://www.w3.org/2000/svg') > -1
    }

    return false
  }

  function hasSvgParent(node: Node): boolean {
    if (node.parent) {
      return isSvgNode(node.parent) || hasSvgParent(node.parent)
    }

    return false
  }

  return isSvgNode(node) || hasSvgParent(node)
}

/**
 * Compile a `Node`.
 *
 * ## Remarks
 *
 * The compiled node parent is always `null`.
 */
export function compileNode(node: Node): DeclaredNode {
  if (isTextNode(node)) {
    return {
      node,
      parent: null,
      type: 'text',
      content: decode(node.textContent)
    }
  }

  const attrs = node.attributes.map(compileAttribute).filter(Boolean) as DeclaredAttribute[]

  const refTag = attrs.find((attr): attr is RefAttribute => attr.type === 'ref')?.name || undefined
  const events = attrs.filter((attr): attr is EventAttribute => attr.type === 'event')
  const variableAttributes = attrs.filter((attr): attr is VariableAttribute => attr.type === 'variable')
  const attributes = attrs.filter((attr): attr is GenericAttribute => attr.type === 'attribute')

  return {
    node,
    parent: null,
    type: shouldRenderAsSvg(node) ? 'svg' : 'element',
    tag: node.tag,
    refTag,
    events,
    variableAttributes,
    attributes: attributes,
    children: []
  }
}

function prepareNodes(nodes: DeclaredNode[]) {
  const rootNodes: DeclaredNode[] = []

  const templates: ElementNode[] = []
  const scripts: ElementNode[] = []
  const styles: ElementNode[] = []

  for (const node of nodes) {
    // only get root nodes
    if (node.parent) {
      continue
    }

    if (node.type === 'element') {
      switch (node.tag) {
        case 'template':
          templates.push(node)
          continue

        case 'script':
          scripts.push(node)
          continue

        case 'style':
          styles.push(node)
          continue
      }
    }

    rootNodes.push(node)
  }

  return {
    rootNodes,
    templates,
    scripts,
    styles
  }
}

function nameof(node: DeclaredNode): string {
  const name = node.type === 'text' ? undefined : node.refTag

  return name ? name : `el${node.node.refId}`
}

function compileHtml(node: DeclaredNode): string {
  let code = ``

  if (node.type === 'text') {
    code += `const ${nameof(node)} = document.createTextNode(${JSON.stringify(node.content)});\n`
  } else {
    if (node.type === 'svg') {
      code += `const ${nameof(node)} = document.createElementNS("http://www.w3.org/2000/svg", "${node.tag}");\n`
    } else {
      code += `const ${nameof(node)} = document.createElement("${node.tag}");\n`
    }

    for (const attr of node.attributes) {
      if (attr.type === 'attribute') {
        if (['width', 'height'].includes(attr.name)) {
          code += `${nameof(node)}.${attr.name} = ${JSON.stringify(attr.value)};\n`
        } else if (attr.name === 'class') {
          code += `${nameof(node)}.className = ${JSON.stringify(attr.value)};\n`
        } else if (attr.name === 'style') {
          code += `${nameof(node)}.style.cssText = ${JSON.stringify(attr.value)};\n`
        } else {
          code += `${nameof(node)}.setAttribute(${JSON.stringify(attr.name)}, ${JSON.stringify(attr.value)});\n`
        }
      }
    }
  }

  if (node.parent) {
    code += `${nameof(node.parent)}.appendChild(${nameof(node)});\n`
  }

  code += `\n`

  return code
}

function walkDeclared(nodes: DeclaredNode[], visitor: (node: DeclaredNode) => void): void {
  nodes.forEach((node) => {
    visitor(node)
    if (node.type !== 'text') {
      walkDeclared(node.children, visitor)
    }
  })
}

export function compile(nodes: Node[]): string
export function compile(html: string): string
export function compile(html: Node[] | string): string {
  const parsedNodes = typeof html === 'string' ? parse(html) : html

  const { rootNodes, templates, scripts, styles } = prepareNodes(
    reduce<DeclaredNode>(parsedNodes, (node, parent) => {
      const compiled = compileNode(node)

      //
      ;(compiled as any).parent = parent

      if (parent?.type !== 'text') {
        parent?.children.push(compiled)
      }

      return compiled
    })
  )

  let compiledCode = `export function compile() {\n`

  interface BindEvent {
    node: DeclaredNode
    event: EventAttribute
  }

  const events: BindEvent[] = []

  walkDeclared(rootNodes, (node) => {
    compiledCode += indent(compileHtml(node).trim())
    compiledCode += `\n`

    if (node.type !== 'text') {
      for (const event of node.events) {
        events.push({
          node,
          event
        })
      }
    }
  })

  walkDeclared(scripts, (node) => {
    if (node.type === 'text') {
      compiledCode += node.content.trim()
      compiledCode += `\n`
      compiledCode += `\n`
    }
  })

  for (const { node, event } of events) {
    compiledCode += `  ${nameof(node)}.addEventListener(${JSON.stringify(event.eventName)}, ${event.variableName})\n`
  }

  compiledCode += `}\n`

  return compiledCode
}

function indent(string: string) {
  let code = ``
  for (let part of string.split('\n')) {
    part = part.trim()
    if (part) {
      code += `  ${part}`
    }
    code += `\n`
  }
  return code
}
