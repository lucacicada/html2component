import { Node, TagNode, walk } from './parser'
import { parse, flat, isTextNode, isTagNode } from './parser'
import { trimAny } from './utils'
import { decode } from 'html-entities'

function shouldRenderAsSvg(node: Node, autoSvg = true) {
  function isSvgNode(node: Node, autoSvg = true): boolean {
    if (isTagNode(node) && node.tag === 'svg') {
      if (autoSvg) return true

      return node.attrs.findIndex((attr) => attr.name === 'xmlns' && attr.value === 'http://www.w3.org/2000/svg') > -1
    }

    return false
  }

  function hasSvgParent(node: Node, autoSvg = true): boolean {
    if (node.parent) {
      return isSvgNode(node.parent, autoSvg) || hasSvgParent(node.parent, autoSvg)
    }

    return false
  }

  return isSvgNode(node, autoSvg) || hasSvgParent(node, autoSvg)
}

export function compile(html: string) {
  const nodes = parse(html)

  const templates: TagNode[] = []
  const scripts: TagNode[] = []
  const styles: TagNode[] = []

  // iterate and remove top level special elements
  for (let i = nodes.length - 1; i > -1; i--) {
    const node = nodes[i]

    if (isTagNode(node)) {
      switch (node.tag) {
        case 'template':
          templates.push(node)
          nodes.splice(i, 1)
          break
        case 'script':
          scripts.push(node)
          nodes.splice(i, 1)
          break
        case 'style':
          styles.push(node)
          nodes.splice(i, 1)
          break
      }
    }
  }

  const nodeRefToVariable = new Map<number, string>()
  function getVariableName(node: Node) {
    return nodeRefToVariable.get(node.refId) || `el${node.refId}`
  }

  walk(nodes, (node) => {
    let name: string

    if (isTagNode(node)) {
      const refName = node.attrs.find((attr) => attr.name === '#ref')?.value
      if (refName === '') {
        name = `el`
      } else if (refName) {
        name = refName
      } else {
        name = `el${node.refId}`
      }
    } else {
      name = `el${node.refId}`
    }

    // TODO: throw
    if (nodeRefToVariable.get(node.refId)) {
      return
    }

    nodeRefToVariable.set(node.refId, name)
  })

  let code = `export function compile() {\n`

  const exportNodes: Node[] = []
  const variableExport: { node: TagNode; attr: string; variable: string }[] = []
  const eventHandlers: { node: TagNode; event: string; variable: string }[] = []

  for (const node of flat(nodes)) {
    if (isTextNode(node)) {
      code += `  const ${getVariableName(node)} = document.createTextNode(${JSON.stringify(decode(node.content))});\n`
    } else if (shouldRenderAsSvg(node)) {
      code += `  const ${getVariableName(node)} = document.createElementNS("http://www.w3.org/2000/svg", "${
        node.tag
      }");\n`
    } else {
      code += `  const ${getVariableName(node)} = document.createElement("${node.tag}");\n`
    }

    if (isTagNode(node)) {
      for (const { name, value } of node.attrs) {
        // compound assignment, unused
        if (name.startsWith('=')) {
          continue
        }

        // variable shorthand
        if (name.startsWith('{')) {
          const variable = trimAny(name, ['{', '}']).trim()

          variableExport.push({
            node,
            attr: variable,
            variable
          })

          continue
        }

        // variable assignment
        if (value.startsWith('{')) {
          // indicates an event
          if (name.indexOf(':') > 0) {
            const eventParts = name.split(':')
            const on = eventParts[0]
            const eventNameParts = eventParts[1].split('|')

            if (on === 'on') {
              const eventName = eventNameParts[0]
              const variable = trimAny(value, ['{', '}']).trim()

              eventHandlers.push({
                node,
                event: eventName,
                variable
              })
            }
          }

          continue
        }

        code += `  ${getVariableName(node)}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`

        // if (name[0].match(/[a-zA-Z]/)) {
        //   code += `  ${getVariableName(node)}.setAttribute(${JSON.stringify(name)}, ${JSON.stringify(value)});\n`
        // }
      }
    }

    if (node.parent === null || templates.findIndex((root) => node.parent!.refId === root.refId) > -1) {
      exportNodes.push(node)
    } else {
      code += `  ${getVariableName(node.parent)}.appendChild(${getVariableName(node)});\n`
    }

    code += `\n`
  }

  // lol?
  if (exportNodes.length === 0) {
    return ''
  }

  const script = typeof scripts[0]?.content[0].content === 'string' ? scripts[0].content[0].content : undefined

  if (script) {
    code += script
    code += `\n`
    code += `\n`
  } else {
    code += `  return {\n`

    if (exportNodes.length === 1) {
      code += `    el: ${getVariableName(exportNodes[0])},\n`
    } else {
      code += `    el: [`
      code += exportNodes.map((node) => `${getVariableName(node)}`).join(', ')
      code += `],\n`
    }

    for (const { node, attr, variable } of variableExport) {
      code += `    get ${variable}() {\n`
      code += `    },\n`

      code += `    set ${variable}(value) {\n`
      code += `      ${getVariableName(node)}.setAttribute("${attr}", value);\n`
      code += `    },\n`
    }

    code += `  }`
  }

  for (const eventHandler of eventHandlers) {
    code += `  ${getVariableName(eventHandler.node)}.addEventListener(${JSON.stringify(eventHandler.event)}, ${
      eventHandler.variable
    })`
  }

  code += `\n}`

  return code
}
